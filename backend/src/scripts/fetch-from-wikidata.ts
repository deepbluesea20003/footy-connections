/**
 * Resumable bulk importer of football squad history from Wikidata.
 *
 * Designed to run as a long-lived batch job (e.g. a GCP Cloud Run Job). It is
 * fully resumable: all progress is checkpointed in Neon, so the job can be
 * killed (SIGTERM / preemption / crash) and re-run, picking up where it left
 * off. Every unit of work is idempotent.
 *
 * Two phases, both checkpointed:
 *   1. discovery  — cursor-paginate every football club that has squad members
 *                   from Wikidata into the `import_club_queue` work table.
 *   2. processing — for each pending club, pull its full member history (P54
 *                   with start/end qualifiers + DOB), expand date ranges into
 *                   seasons, and upsert players + player_club_seasons. Each club
 *                   is an atomic checkpoint (status -> done).
 *
 * Players are deduped across sources via the identity resolver (Wikidata QID as
 * external_id; name+DOB as the cross-source key). Clubs are keyed by QID.
 *
 * Run: DATABASE_URL=... npm run import:wikidata --workspace=backend
 * Tune via env: MIN_SEASON_YEAR, WIKIDATA_DELAY_MS, PROCESS_LIMIT, WIKIDATA_UA.
 */
import { neon } from "@neondatabase/serverless";
import { normalizeClubName } from "../utils/string.js";
import { seasonsBetween } from "../utils/season.js";
import { createIdentityResolver } from "../db/player-identity.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

const ENDPOINT = process.env.WIKIDATA_SPARQL ?? "https://query.wikidata.org/sparql";
const UA =
  process.env.WIKIDATA_UA ??
  "footy-connections/0.1 (https://github.com/deepbluesea20003/footy-connections)";
const MIN_SEASON_YEAR = Number(process.env.MIN_SEASON_YEAR ?? 1888);
const CURRENT_SEASON_START_YEAR = Number(process.env.CURRENT_SEASON_START_YEAR ?? 2025);
const REQUEST_DELAY_MS = Number(process.env.WIKIDATA_DELAY_MS ?? 1500);
const DISCOVERY_PAGE_SIZE = Number(process.env.DISCOVERY_PAGE_SIZE ?? 800);
const DISCOVERY_MAX_PAGES = Number(process.env.DISCOVERY_MAX_PAGES ?? Infinity); // cap pages/run
const PROCESS_BATCH = Number(process.env.PROCESS_BATCH ?? 50);
const PROCESS_LIMIT = Number(process.env.PROCESS_LIMIT ?? Infinity); // cap clubs/run (testing)
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [5000, 15000, 45000];

let stopping = false;
process.on("SIGTERM", () => { console.log(`[${ts()}] SIGTERM — finishing current item then exiting`); stopping = true; });
process.on("SIGINT", () => { console.log(`[${ts()}] SIGINT — finishing current item then exiting`); stopping = true; });

function sleep(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)); }
function ts() { return new Date().toISOString().substring(11, 19); }

interface Binding { [k: string]: { value: string } | undefined; }

async function sparql(query: string): Promise<Binding[]> {
  let lastErr = "";
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1]);
    let res: Response;
    try {
      res = await fetch(`${ENDPOINT}?query=${encodeURIComponent(query)}&format=json`, {
        headers: { "User-Agent": UA, Accept: "application/sparql-results+json" },
      });
    } catch (e) {
      lastErr = String(e);
      continue;
    }
    if (res.ok) {
      const json = (await res.json()) as { results: { bindings: Binding[] } };
      return json.results.bindings;
    }
    if (res.status === 429) {
      const ra = res.headers.get("Retry-After");
      const waitMs = ra ? parseInt(ra, 10) * 1000 : RETRY_DELAYS_MS[attempt] ?? 60000;
      console.warn(`  [${ts()}] 429 — waiting ${waitMs / 1000}s`);
      await sleep(waitMs);
      continue;
    }
    lastErr = `HTTP ${res.status}`;
    if (res.status < 500) break; // non-retryable
  }
  throw new Error(`SPARQL failed: ${lastErr}`);
}

function discoveryQuery(cursor: string): string {
  return `
    SELECT ?club ?clubLabel WHERE {
      { SELECT DISTINCT ?club WHERE {
          ?stmt ps:P54 ?club .
          ?club wdt:P31 wd:Q476028 .
          FILTER(STR(?club) > "${cursor}")
        } ORDER BY STR(?club) LIMIT ${DISCOVERY_PAGE_SIZE} }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }`;
}

function membershipQuery(qid: string): string {
  return `
    SELECT ?player ?playerLabel ?dob ?start ?end WHERE {
      ?player p:P54 ?stmt .
      ?stmt ps:P54 wd:${qid} .
      ?player wdt:P106 wd:Q937857 .
      OPTIONAL { ?player wdt:P569 ?dob. }
      OPTIONAL { ?stmt pq:P580 ?start. }
      OPTIONAL { ?stmt pq:P582 ?end. }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }`;
}

const qidOf = (uri: string) => uri.split("/").pop() ?? uri;

/** Self-bootstrap the job's queue tables so the importer runs against a fresh DB. */
async function ensureSchema() {
  await sql`CREATE TABLE IF NOT EXISTS import_jobs (
    id TEXT PRIMARY KEY,
    phase TEXT NOT NULL DEFAULT 'discovery',
    discovery_cursor TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS import_club_queue (
    club_qid TEXT PRIMARY KEY,
    club_name TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    member_rows INT,
    season_rows INT,
    attempts INT NOT NULL DEFAULT 0,
    last_error TEXT,
    processed_at TIMESTAMPTZ
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_icq_status ON import_club_queue(status)`;
}

async function getJob() {
  const rows = (await sql`SELECT phase, discovery_cursor FROM import_jobs WHERE id = 'wikidata'`) as
    { phase: string; discovery_cursor: string }[];
  if (rows.length === 0) {
    await sql`INSERT INTO import_jobs (id, phase, discovery_cursor) VALUES ('wikidata', 'discovery', '')`;
    return { phase: "discovery", discovery_cursor: "" };
  }
  return rows[0];
}

async function discover() {
  const job = await getJob();
  if (job.phase !== "discovery") {
    console.log(`[${ts()}] discovery already complete; skipping to processing`);
    return;
  }
  let cursor = job.discovery_cursor;
  let total = 0;
  let pages = 0;
  console.log(`[${ts()}] DISCOVERY starting at cursor "${cursor || "(beginning)"}"`);

  while (!stopping) {
    if (pages >= DISCOVERY_MAX_PAGES) {
      console.log(`[${ts()}] discovery page cap (${DISCOVERY_MAX_PAGES}) reached — will resume next run`);
      return;
    }
    const rows = await sparql(discoveryQuery(cursor));
    pages++;
    if (rows.length === 0) break;

    for (const r of rows) {
      const qid = qidOf(r.club!.value);
      const name = r.clubLabel?.value && !/^Q\d+$/.test(r.clubLabel.value) ? r.clubLabel.value : qid;
      await sql`
        INSERT INTO import_club_queue (club_qid, club_name)
        VALUES (${qid}, ${name})
        ON CONFLICT (club_qid) DO NOTHING`;
    }
    total += rows.length;
    cursor = rows[rows.length - 1].club!.value;
    await sql`UPDATE import_jobs SET discovery_cursor = ${cursor}, updated_at = now() WHERE id = 'wikidata'`;
    console.log(`[${ts()}] discovered +${rows.length} (total ${total}) cursor=${qidOf(cursor)}`);

    if (rows.length < DISCOVERY_PAGE_SIZE) break;
    await sleep(REQUEST_DELAY_MS);
  }

  if (!stopping) {
    await sql`UPDATE import_jobs SET phase = 'processing', updated_at = now() WHERE id = 'wikidata'`;
    const [{ count }] = (await sql`SELECT COUNT(*)::text AS count FROM import_club_queue`) as [{ count: string }];
    console.log(`[${ts()}] DISCOVERY complete — ${count} clubs queued`);
  }
}

type Resolver = ReturnType<typeof createIdentityResolver>;

async function processClub(qid: string, name: string, resolver: Resolver) {
  const rows = await sparql(membershipQuery(qid));

  await sql`
    INSERT INTO clubs (id, name)
    VALUES (${qid}, ${normalizeClubName(name)})
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`;

  let seasonRows = 0;
  for (const row of rows) {
    const label = row.playerLabel?.value;
    if (!label || /^Q\d+$/.test(label)) continue; // no usable English name

    const dob = row.dob?.value ? row.dob.value.slice(0, 10) : null;
    const playerId = await resolver.resolveOrCreatePlayer({
      name: label,
      dateOfBirth: dob,
      source: "wikidata",
      externalId: qidOf(row.player!.value),
    });

    const seasons = seasonsBetween(row.start?.value ?? null, row.end?.value ?? null, {
      minYear: MIN_SEASON_YEAR,
      currentSeasonStartYear: CURRENT_SEASON_START_YEAR,
    });
    for (const season of seasons) {
      await sql`
        INSERT INTO player_club_seasons (player_id, club_id, season)
        VALUES (${playerId}, ${qid}, ${season})
        ON CONFLICT DO NOTHING`;
      seasonRows++;
    }
  }
  return { memberRows: rows.length, seasonRows };
}

async function processClubs(resolver: Resolver) {
  let processed = 0;
  console.log(`[${ts()}] PROCESSING (batch=${PROCESS_BATCH}, limit=${PROCESS_LIMIT})`);

  while (!stopping && processed < PROCESS_LIMIT) {
    const batch = (await sql`
      SELECT club_qid, club_name FROM import_club_queue
      WHERE status = 'pending' OR (status = 'error' AND attempts < ${MAX_ATTEMPTS})
      ORDER BY club_qid
      LIMIT ${PROCESS_BATCH}`) as { club_qid: string; club_name: string }[];
    if (batch.length === 0) break;

    for (const club of batch) {
      if (stopping || processed >= PROCESS_LIMIT) break;
      try {
        const { memberRows, seasonRows } = await processClub(club.club_qid, club.club_name, resolver);
        await sql`
          UPDATE import_club_queue
          SET status = 'done', member_rows = ${memberRows}, season_rows = ${seasonRows}, processed_at = now()
          WHERE club_qid = ${club.club_qid}`;
        processed++;
        console.log(`[${ts()}] [${processed}] ${club.club_name}: ${memberRows} members → ${seasonRows} season-rows`);
      } catch (e) {
        await sql`
          UPDATE import_club_queue
          SET status = 'error', attempts = attempts + 1, last_error = ${String(e).slice(0, 500)}
          WHERE club_qid = ${club.club_qid}`;
        console.error(`[${ts()}] ERROR ${club.club_name} (${club.club_qid}): ${e}`);
      }
      await sleep(REQUEST_DELAY_MS);
    }
  }
  console.log(`[${ts()}] processed ${processed} clubs this run`);
}

async function main() {
  await ensureSchema();
  const resolver = createIdentityResolver(sql);
  await discover();
  if (!stopping) await processClubs(resolver);

  const [{ players }] = (await sql`SELECT COUNT(*)::text AS players FROM players`) as [{ players: string }];
  const [{ rows }] = (await sql`SELECT COUNT(*)::text AS rows FROM player_club_seasons`) as [{ rows: string }];
  const [{ done }] = (await sql`SELECT COUNT(*)::text AS done FROM import_club_queue WHERE status = 'done'`) as [{ done: string }];
  const [{ pending }] = (await sql`SELECT COUNT(*)::text AS pending FROM import_club_queue WHERE status = 'pending'`) as [{ pending: string }];
  console.log(`[${ts()}] DB totals: ${players} players, ${rows} club-season rows | clubs done=${done} pending=${pending}`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
