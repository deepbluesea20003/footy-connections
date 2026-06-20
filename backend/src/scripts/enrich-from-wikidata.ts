/**
 * Enriches players with search-ranking signals pulled from Wikidata, keyed on
 * the QID we already store in player_external_ids (source='wikidata').
 *
 * For each player it fetches, in batched SPARQL queries (no API key, free):
 *   - sitelinks  — number of Wikipedia language editions about the player; a
 *                  strong global-fame proxy (the legendary Pelé has ~180, his
 *                  namesakes ~10), used as the backbone of the ranking score.
 *   - image_file — Wikimedia Commons filename (P18) for a result thumbnail.
 *   - nationality — country label (P27); backfills the column non-destructively.
 *
 * It then computes players.popularity = a blend of sitelinks (primary) plus a
 * light career-length / recency term derived from player_club_seasons, so an
 * active, much-capped player isn't buried under a long-retired one with a few
 * more language articles. search() orders same-name matches by this score.
 *
 * Idempotent + resumable: only players whose sitelinks are still NULL are
 * fetched, and missing/deleted entities are stamped with 0 so they aren't
 * retried forever. Re-run any time; pass --recompute to redo only the
 * popularity blend (e.g. after tuning the weights) without re-hitting Wikidata.
 *
 * Run: DATABASE_URL=... npm run enrich:wikidata --workspace=backend
 */
import { neon } from "@neondatabase/serverless";

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
const BATCH = Number(process.env.ENRICH_BATCH ?? 200);          // QIDs per SPARQL query
const CHUNK = Number(process.env.ENRICH_CHUNK ?? 2000);         // players per DB page
const DELAY_MS = Number(process.env.WIKIDATA_DELAY_MS ?? 1500); // between SPARQL calls
const LIMIT = Number(process.env.ENRICH_LIMIT ?? Infinity);     // cap players/run (testing)
const CURRENT_SEASON_START_YEAR = Number(process.env.CURRENT_SEASON_START_YEAR ?? 2025);
const RECENT_SINCE_YEAR = CURRENT_SEASON_START_YEAR - 3;        // "active" if seen since this
const REQUEST_TIMEOUT_MS = Number(process.env.WIKIDATA_TIMEOUT_MS ?? 90000);
const RETRY_DELAYS_MS = [5000, 15000, 45000];
const MAX_BACKOFF_MS = 120000;

function sleep(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)); }
function ts() { return new Date().toISOString().substring(11, 19); }
const qidOf = (uri: string) => uri.split("/").pop() ?? uri;

interface Binding { [k: string]: { value: string } | undefined; }

async function sparql(query: string): Promise<Binding[]> {
  let lastErr = "";
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1]);
    let res: Response;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      // POST the query in the body (not the URL): a batch of hundreds of QIDs
      // makes a multi-KB query that overflows the endpoint's request-line limit
      // as a GET (HTTP 431). POST has no such ceiling.
      res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "User-Agent": UA,
          Accept: "application/sparql-results+json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: `query=${encodeURIComponent(query)}&format=json`,
        signal: ctrl.signal,
      });
    } catch (e) {
      lastErr = String(e);
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
    if (res.status < 500) break;
  }
  throw new Error(`SPARQL failed: ${lastErr}`);
}

/** One query per batch: sitelink count + a sample image + a sample English
 *  nationality label for each QID. SAMPLE collapses multiple values; COUNT
 *  DISTINCT keeps the sitelink tally correct despite the cross-product. */
function enrichmentQuery(qids: string[]): string {
  const values = qids.map((q) => `wd:${q}`).join(" ");
  return `
    SELECT ?item (COUNT(DISTINCT ?sl) AS ?sitelinks) (SAMPLE(?img) AS ?image) (SAMPLE(?cl) AS ?country) WHERE {
      VALUES ?item { ${values} }
      OPTIONAL { ?sl schema:about ?item . }
      OPTIONAL { ?item wdt:P18 ?img . }
      OPTIONAL { ?item wdt:P27 ?c . ?c rdfs:label ?cl . FILTER(lang(?cl) = "en") }
    } GROUP BY ?item`;
}

const imageFileOf = (uri: string | undefined): string | null =>
  uri ? uri.split("Special:FilePath/").pop() ?? null : null;

async function ensureColumns() {
  await sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS sitelinks INT`;
  await sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS image_file TEXT`;
  await sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS popularity REAL`;
  await sql`CREATE INDEX IF NOT EXISTS idx_players_popularity ON players(popularity DESC NULLS LAST)`;
}

/** Blend sitelinks (primary) with a light career/recency term, in one server-
 *  side pass over all players. Cheap to re-run after tuning the weights. */
async function recomputePopularity() {
  console.log(`[${ts()}] recomputing popularity (active boost since ${RECENT_SINCE_YEAR})...`);
  await sql`
    UPDATE players p SET popularity = sub.pop
    FROM (
      SELECT pl.id,
        log(10, 1 + GREATEST(COALESCE(pl.sitelinks, 0), 0))
        + 0.25 * log(10, 1 + COALESCE(agg.seasons, 0))
        + CASE WHEN agg.last_year >= ${RECENT_SINCE_YEAR} THEN 0.15 ELSE 0 END AS pop
      FROM players pl
      LEFT JOIN (
        SELECT player_id, COUNT(*) AS seasons, MAX(NULLIF(LEFT(season, 4), '')::int) AS last_year
        FROM player_club_seasons GROUP BY player_id
      ) agg ON agg.player_id = pl.id
    ) sub
    WHERE p.id = sub.id`;
}

async function enrich() {
  let cursor = "";
  let processed = 0;
  let withImage = 0;
  let withCountry = 0;

  while (processed < LIMIT) {
    const rows = (await sql`
      SELECT pei.player_id, pei.external_id
      FROM player_external_ids pei
      JOIN players p ON p.id = pei.player_id
      WHERE pei.source = 'wikidata' AND p.sitelinks IS NULL AND pei.player_id > ${cursor}
      ORDER BY pei.player_id
      LIMIT ${Math.min(CHUNK, LIMIT - processed)}`) as { player_id: string; external_id: string }[];
    if (rows.length === 0) break;

    // QID -> enrichment, gathered across this chunk's SPARQL batches.
    const data = new Map<string, { sitelinks: number; image: string | null; country: string | null }>();
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const bindings = await sparql(enrichmentQuery(batch.map((r) => r.external_id)));
      for (const b of bindings) {
        data.set(qidOf(b.item!.value), {
          sitelinks: b.sitelinks ? parseInt(b.sitelinks.value, 10) : 0,
          image: imageFileOf(b.image?.value),
          country: b.country?.value ?? null,
        });
      }
      await sleep(DELAY_MS);
    }

    // Build update arrays for every player in the chunk — missing entities get
    // sitelinks=0 so the IS NULL resume filter doesn't re-fetch them forever.
    const ids: string[] = [];
    const sitelinks: number[] = [];
    const images: (string | null)[] = [];
    const countries: (string | null)[] = [];
    for (const r of rows) {
      const d = data.get(r.external_id);
      ids.push(r.player_id);
      sitelinks.push(d?.sitelinks ?? 0);
      images.push(d?.image ?? null);
      countries.push(d?.country ?? null);
      if (d?.image) withImage++;
      if (d?.country) withCountry++;
    }

    await sql`
      UPDATE players p SET
        sitelinks   = u.sitelinks,
        image_file  = COALESCE(u.image_file, p.image_file),
        nationality = COALESCE(p.nationality, u.nationality)
      FROM unnest(${ids}::text[], ${sitelinks}::int[], ${images}::text[], ${countries}::text[])
        AS u(id, sitelinks, image_file, nationality)
      WHERE p.id = u.id`;

    processed += rows.length;
    cursor = rows[rows.length - 1].player_id;
    console.log(`[${ts()}] enriched ${processed} players (images ${withImage}, nationalities ${withCountry})`);
  }

  return processed;
}

async function main() {
  await ensureColumns();

  if (process.argv.includes("--recompute")) {
    await recomputePopularity();
  } else {
    const n = await enrich();
    console.log(`[${ts()}] fetch phase done — ${n} players enriched this run`);
    await recomputePopularity();
  }

  const [{ total }] = (await sql`SELECT COUNT(*)::text AS total FROM players`) as [{ total: string }];
  const [{ done }] = (await sql`SELECT COUNT(*)::text AS done FROM players WHERE sitelinks IS NOT NULL`) as [{ done: string }];
  const [{ imgs }] = (await sql`SELECT COUNT(*)::text AS imgs FROM players WHERE image_file IS NOT NULL`) as [{ imgs: string }];
  console.log(`[${ts()}] DONE — ${done}/${total} players enriched, ${imgs} with photos`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
