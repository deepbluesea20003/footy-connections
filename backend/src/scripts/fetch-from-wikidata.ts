/**
 * Resumable bulk importer of football squad history from Wikidata.
 *
 * Designed to run as a long-lived batch job (e.g. a GCP Cloud Run Job). It is
 * fully resumable: all progress is checkpointed in Neon, so the job can be
 * killed (SIGTERM / preemption / crash) and re-run, picking up where it left
 * off. Every unit of work is idempotent.
 *
 * Two phases, both checkpointed:
 *   1. discovery  — one query enumerates every football club with at least
 *                   MIN_CLUB_MEMBERS squad members, ordered by notability, into
 *                   the `import_club_queue` work table.
 *   2. processing — clubs are processed most-notable-first. For each, pull the
 *                   full member history (P54 with start/end qualifiers + DOB),
 *                   expand date ranges into seasons, and upsert players +
 *                   player_club_seasons. Each club is an atomic checkpoint.
 *
 * Processing stops when the database approaches MAX_DB_BYTES, so the most
 * valuable (most-connected) clubs are imported first and the job stays within
 * a storage budget (e.g. Neon's free tier). Players dedupe across sources via
 * the identity resolver (QID external_id + name/DOB); clubs are keyed by QID.
 *
 * Run: DATABASE_URL=... npm run import:wikidata --workspace=backend
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
const MIN_CLUB_MEMBERS = Number(process.env.MIN_CLUB_MEMBERS ?? 30);
const MAX_DB_BYTES = Number(process.env.MAX_DB_BYTES ?? 440 * 1024 * 1024); // stay under free-tier
const MIN_SEASON_YEAR = Number(process.env.MIN_SEASON_YEAR ?? 1888);
const CURRENT_SEASON_START_YEAR = Number(process.env.CURRENT_SEASON_START_YEAR ?? 2025);
const REQUEST_DELAY_MS = Number(process.env.WIKIDATA_DELAY_MS ?? 1500);
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

const REQUEST_TIMEOUT_MS = Number(process.env.WIKIDATA_TIMEOUT_MS ?? 90000);
const MAX_BACKOFF_MS = 120000; // never wait more than 2 min on a single retry

async function sparql(query: string): Promise<Binding[]> {
  let lastErr = "";
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1]);
    let res: Response;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      res = await fetch(`${ENDPOINT}?query=${encodeURIComponent(query)}&format=json`, {
        headers: { "User-Agent": UA, Accept: "application/sparql-results+json" },
        signal: ctrl.signal,
      });
    } catch (e) {
      lastErr = String(e); // includes AbortError on timeout — retry
      continue;
    } finally {
      clearTimeout(timer);
    }
    if (res.ok) {
      const json = (await res.json()) as { results: { bindings: Binding[] } };
      return json.results.bindings;
    }
    if (res.status === 429) {
      const ra = res.headers.get("Retry-After");
      const waitMs = Math.min(ra ? parseInt(ra, 10) * 1000 : RETRY_DELAYS_MS[attempt] ?? 60000, MAX_BACKOFF_MS);
      console.warn(`  [${ts()}] 429 — waiting ${(waitMs / 1000).toFixed(0)}s`);
      await sleep(waitMs);
      continue;
    }
    lastErr = `HTTP ${res.status}`;
    if (res.status < 500) break; // non-retryable
  }
  throw new Error(`SPARQL failed: ${lastErr}`);
}

function discoveryQuery(): string {
  return `
    SELECT ?club ?n WHERE {
      { SELECT ?club (COUNT(?s) AS ?n) WHERE {
          ?s ps:P54 ?club .
          ?club wdt:P31 wd:Q476028 .
        } GROUP BY ?club HAVING(COUNT(?s) >= ${MIN_CLUB_MEMBERS}) }
    } ORDER BY DESC(?n)`;
}

function membershipQuery(qid: string): string {
  return `
    SELECT ?player ?playerLabel ?dob ?start ?end ?clubLabel WHERE {
      ?player p:P54 ?stmt .
      ?stmt ps:P54 wd:${qid} .
      ?player wdt:P106 wd:Q937857 .
      BIND(wd:${qid} AS ?club)
      OPTIONAL { ?player wdt:P569 ?dob. }
      OPTIONAL { ?stmt pq:P580 ?start. }
      OPTIONAL { ?stmt pq:P582 ?end. }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }`;
}

const qidOf = (uri: string) => uri.split("/").pop() ?? uri;

/** Wikidata occasionally yields garbage values (URLs) where a date is expected. */
function validDate(v: string | undefined): string | null {
  if (!v) return null;
  const d = v.slice(0, 10);
  return /^\d{3,4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

/** Self-bootstrap the job's queue tables so the importer runs against a fresh DB. */
async function ensureSchema() {
  await sql`CREATE TABLE IF NOT EXISTS import_jobs (
    id TEXT PRIMARY KEY, phase TEXT NOT NULL DEFAULT 'discovery',
    discovery_cursor TEXT NOT NULL DEFAULT '', updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS import_club_queue (
    club_qid TEXT PRIMARY KEY, club_name TEXT, status TEXT NOT NULL DEFAULT 'pending',
    member_rows INT, season_rows INT, attempts INT NOT NULL DEFAULT 0,
    last_error TEXT, processed_at TIMESTAMPTZ
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_icq_status ON import_club_queue(status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_icq_pending ON import_club_queue(status, member_rows DESC)`;
}

async function dbSize(): Promise<number> {
  const [{ bytes }] = (await sql`SELECT pg_database_size(current_database())::text AS bytes`) as [{ bytes: string }];
  return Number(bytes);
}

async function getJob() {
  const rows = (await sql`SELECT phase FROM import_jobs WHERE id = 'wikidata'`) as { phase: string }[];
  if (rows.length === 0) {
    await sql`INSERT INTO import_jobs (id, phase) VALUES ('wikidata', 'discovery')`;
    return { phase: "discovery" };
  }
  return rows[0];
}

async function discover() {
  const job = await getJob();
  if (job.phase !== "discovery") {
    console.log(`[${ts()}] discovery already complete; skipping to processing`);
    return;
  }
  console.log(`[${ts()}] DISCOVERY — clubs with >= ${MIN_CLUB_MEMBERS} members (notability-ordered)`);
  const rows = await sparql(discoveryQuery());
  const qids = rows.map((r) => qidOf(r.club!.value));
  const members = rows.map((r) => (r.n?.value ? parseInt(r.n.value, 10) : 0));
  console.log(`[${ts()}] discovered ${rows.length} clubs; bulk-enqueueing...`);

  await sql`
    INSERT INTO import_club_queue (club_qid, club_name, member_rows)
    SELECT q, q, m FROM unnest(${qids}::text[], ${members}::int[]) AS t(q, m)
    ON CONFLICT (club_qid) DO NOTHING`;

  await sql`UPDATE import_jobs SET phase = 'processing', updated_at = now() WHERE id = 'wikidata'`;
  console.log(`[${ts()}] DISCOVERY complete — ${rows.length} clubs queued`);
}

type Resolver = ReturnType<typeof createIdentityResolver>;

async function chunkedInsert<T>(items: T[], size: number, fn: (chunk: T[]) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) await fn(items.slice(i, i + size));
}

async function processClub(qid: string, resolver: Resolver) {
  const rows = await sparql(membershipQuery(qid));

  const clubName = normalizeClubName(
    rows.find((r) => r.clubLabel?.value && !/^Q\d+$/.test(r.clubLabel.value))?.clubLabel?.value ?? qid
  );
  await sql`
    INSERT INTO clubs (id, name) VALUES (${qid}, ${clubName})
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`;

  // Resolve all members in memory. We always bulk-insert every member's player
  // row (ON CONFLICT DO NOTHING) rather than trusting the cache to decide what's
  // new — this keeps the DB a superset of the cache, so player_club_seasons /
  // external_ids can never hit a missing-FK even if a prior insert failed.
  const players: { id: string; name: string; dob: string | null }[] = [];
  const extIds: { ext: string; pid: string }[] = [];
  const seasonPairs: { pid: string; season: string }[] = [];
  const seenPlayer = new Set<string>();
  const seenSeason = new Set<string>();

  for (const row of rows) {
    const label = row.playerLabel?.value;
    if (!label || /^Q\d+$/.test(label)) continue; // no usable English name

    const playerQid = qidOf(row.player!.value);
    const dob = validDate(row.dob?.value);
    const res = resolver.resolveInMemory({
      name: label,
      dateOfBirth: dob,
      source: "wikidata",
      externalId: playerQid,
    });

    if (!seenPlayer.has(res.playerId)) {
      seenPlayer.add(res.playerId);
      players.push({ id: res.playerId, name: label, dob });
      extIds.push({ ext: playerQid, pid: res.playerId });
    }

    for (const season of seasonsBetween(row.start?.value ?? null, row.end?.value ?? null, {
      minYear: MIN_SEASON_YEAR,
      currentSeasonStartYear: CURRENT_SEASON_START_YEAR,
    })) {
      const key = `${res.playerId} ${season}`;
      if (!seenSeason.has(key)) {
        seenSeason.add(key);
        seasonPairs.push({ pid: res.playerId, season });
      }
    }
  }

  await chunkedInsert(players, 1000, async (c) => {
    await sql`INSERT INTO players (id, name, date_of_birth)
      SELECT * FROM unnest(${c.map((p) => p.id)}::text[], ${c.map((p) => p.name)}::text[], ${c.map((p) => p.dob)}::date[])
      ON CONFLICT (id) DO NOTHING`;
  });
  await chunkedInsert(extIds, 1000, async (c) => {
    await sql`INSERT INTO player_external_ids (source, external_id, player_id)
      SELECT 'wikidata', ext, pid FROM unnest(${c.map((e) => e.ext)}::text[], ${c.map((e) => e.pid)}::text[]) AS t(ext, pid)
      ON CONFLICT DO NOTHING`;
  });
  await chunkedInsert(seasonPairs, 4000, async (c) => {
    await sql`INSERT INTO player_club_seasons (player_id, club_id, season)
      SELECT pid, ${qid}, ssn FROM unnest(${c.map((s) => s.pid)}::text[], ${c.map((s) => s.season)}::text[]) AS t(pid, ssn)
      ON CONFLICT DO NOTHING`;
  });

  return { memberRows: rows.length, seasonRows: seasonPairs.length, clubName };
}

async function processClubs(resolver: Resolver) {
  let processed = 0;
  console.log(`[${ts()}] PROCESSING (notable-first, db budget ${(MAX_DB_BYTES / 1024 / 1024).toFixed(0)} MB)`);
  console.log(`[${ts()}] loading identity caches...`);
  await resolver.load();
  console.log(`[${ts()}] caches loaded`);

  while (!stopping && processed < PROCESS_LIMIT) {
    const size = await dbSize();
    if (size >= MAX_DB_BYTES) {
      console.log(`[${ts()}] DB size ${(size / 1024 / 1024).toFixed(0)} MB >= budget — stopping (within free tier)`);
      return "budget";
    }

    const batch = (await sql`
      SELECT club_qid FROM import_club_queue
      WHERE status = 'pending' OR (status = 'error' AND attempts < ${MAX_ATTEMPTS})
      ORDER BY member_rows DESC NULLS LAST, club_qid
      LIMIT ${PROCESS_BATCH}`) as { club_qid: string }[];
    if (batch.length === 0) break;

    for (const { club_qid } of batch) {
      if (stopping || processed >= PROCESS_LIMIT) break;
      try {
        const { memberRows, seasonRows, clubName } = await processClub(club_qid, resolver);
        await sql`
          UPDATE import_club_queue
          SET status = 'done', club_name = ${clubName}, member_rows = ${memberRows},
              season_rows = ${seasonRows}, processed_at = now()
          WHERE club_qid = ${club_qid}`;
        processed++;
        if (processed % 10 === 0 || memberRows > 400) {
          console.log(`[${ts()}] [${processed}] ${clubName}: ${memberRows} members → ${seasonRows} rows`);
        }
      } catch (e) {
        await sql`
          UPDATE import_club_queue
          SET status = 'error', attempts = attempts + 1, last_error = ${String(e).slice(0, 500)}
          WHERE club_qid = ${club_qid}`;
        console.error(`[${ts()}] ERROR ${club_qid}: ${e}`);
      }
      await sleep(REQUEST_DELAY_MS);
    }
  }

  const [{ pending }] = (await sql`
    SELECT COUNT(*)::text AS pending FROM import_club_queue WHERE status = 'pending'`) as [{ pending: string }];
  if (Number(pending) === 0 && !stopping) {
    await sql`UPDATE import_jobs SET phase = 'done', updated_at = now() WHERE id = 'wikidata'`;
    console.log(`[${ts()}] ALL clubs processed — job done`);
    return "done";
  }
  return "stopped";
}

function isTransient(e: unknown): boolean {
  return /fetch failed|ECONNRESET|Error connecting to database|ETIMEDOUT|EAI_AGAIN|socket hang up|terminating connection|Connection terminated/i.test(String(e));
}

async function main() {
  await ensureSchema();
  const resolver = createIdentityResolver(sql);

  // Top-level resilience: transient DB/network blips re-enter processing, which
  // resumes from the queue checkpoint and self-heals via ON CONFLICT inserts.
  let outcome = "stopped";
  for (let attempt = 0; !stopping; attempt++) {
    try {
      await discover();
      outcome = (await processClubs(resolver)) ?? "stopped";
      break;
    } catch (e) {
      if (!isTransient(e) || stopping) throw e;
      console.warn(`[${ts()}] transient failure (attempt ${attempt + 1}) — retry in 10s: ${String(e).slice(0, 160)}`);
      await sleep(10000);
    }
  }

  const [{ players }] = (await sql`SELECT COUNT(*)::text AS players FROM players`) as [{ players: string }];
  const [{ rows }] = (await sql`SELECT COUNT(*)::text AS rows FROM player_club_seasons`) as [{ rows: string }];
  const [{ done }] = (await sql`SELECT COUNT(*)::text AS done FROM import_club_queue WHERE status='done'`) as [{ done: string }];
  const [{ pending }] = (await sql`SELECT COUNT(*)::text AS pending FROM import_club_queue WHERE status='pending'`) as [{ pending: string }];
  const size = await dbSize();
  console.log(`[${ts()}] OUTCOME=${outcome} | ${players} players, ${rows} club-season rows | clubs done=${done} pending=${pending} | db ${(size / 1024 / 1024).toFixed(0)} MB`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
