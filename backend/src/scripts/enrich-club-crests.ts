/**
 * Attaches crest images to clubs for the connection UI. Two sources, in order:
 *
 *   1. football-data.org (if FOOTBALL_DATA_API_KEY is set) — real crests for the
 *      major-league clubs that show up in most connections. Matched to our clubs
 *      by normalized name.
 *   2. Wikidata P154 — free SVG/logo crests for the (~5% of) clubs that have one,
 *      filling any club football-data didn't cover.
 *
 * Clubs left without a crest fall back to a generated monogram badge in the UI.
 * Idempotent: only fills clubs whose crest_url IS NULL, so re-running is cheap
 * and additive (e.g. after the importer adds new clubs, or once you add a key).
 *
 * Run: DATABASE_URL=... [FOOTBALL_DATA_API_KEY=...] npm run enrich:crests --workspace=backend
 */
import { neon } from "@neondatabase/serverless";
import { normalize, normalizeClubName } from "../utils/string.js";
import { commonsThumbUrl } from "../utils/image.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}
const sql = neon(DATABASE_URL);

const FD_KEY = process.env.FOOTBALL_DATA_API_KEY;
const FD_BASE = "https://api.football-data.org/v4";
// football-data free tier ("Tier One") competitions; restricted ones 403 and skip.
const FD_COMPETITIONS = (process.env.FD_COMPETITIONS ??
  "PL,ELC,BL1,SA,PD,FL1,DED,PPL,BSA,CL,EC,WC").split(",");
const FD_DELAY_MS = Number(process.env.FOOTBALL_DATA_DELAY_MS ?? 7000);

const WD_ENDPOINT = process.env.WIKIDATA_SPARQL ?? "https://query.wikidata.org/sparql";
const UA = process.env.WIKIDATA_UA ?? "footy-connections/0.1 (crest-enrichment)";
const WD_BATCH = Number(process.env.ENRICH_BATCH ?? 300);
const WD_DELAY_MS = Number(process.env.WIKIDATA_DELAY_MS ?? 1000);

function sleep(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)); }
function ts() { return new Date().toISOString().substring(11, 19); }
const key = (name: string) => normalize(normalizeClubName(name));

async function ensureColumn() {
  await sql`ALTER TABLE clubs ADD COLUMN IF NOT EXISTS crest_url TEXT`;
}

async function applyCrests(pairs: { id: string; url: string }[]) {
  if (pairs.length === 0) return;
  await sql`
    UPDATE clubs c SET crest_url = u.url
    FROM unnest(${pairs.map((p) => p.id)}::text[], ${pairs.map((p) => p.url)}::text[]) AS u(id, url)
    WHERE c.id = u.id AND c.crest_url IS NULL`;
}

/** Phase 1: football-data crests, matched to our crest-less clubs by name. */
async function enrichFromFootballData(): Promise<number> {
  if (!FD_KEY) {
    console.log(`[${ts()}] FOOTBALL_DATA_API_KEY not set — skipping football-data crests`);
    return 0;
  }
  const nameToCrest = new Map<string, string>();
  for (const comp of FD_COMPETITIONS) {
    try {
      const res = await fetch(`${FD_BASE}/competitions/${comp}/teams`, {
        headers: { "X-Auth-Token": FD_KEY },
      });
      if (!res.ok) {
        console.warn(`[${ts()}] ${comp}: HTTP ${res.status} — skipping`);
        await sleep(FD_DELAY_MS);
        continue;
      }
      const data = (await res.json()) as { teams?: { name: string; shortName?: string; crest?: string }[] };
      let n = 0;
      for (const t of data.teams ?? []) {
        if (!t.crest) continue;
        nameToCrest.set(key(t.name), t.crest);
        if (t.shortName) nameToCrest.set(key(t.shortName), t.crest);
        n++;
      }
      console.log(`[${ts()}] ${comp}: ${n} crests`);
    } catch (e) {
      console.warn(`[${ts()}] ${comp}: ${e}`);
    }
    await sleep(FD_DELAY_MS);
  }

  const clubs = (await sql`SELECT id, name FROM clubs WHERE crest_url IS NULL`) as { id: string; name: string }[];
  const pairs: { id: string; url: string }[] = [];
  for (const c of clubs) {
    const url = nameToCrest.get(key(c.name));
    if (url) pairs.push({ id: c.id, url });
  }
  await applyCrests(pairs);
  console.log(`[${ts()}] football-data matched ${pairs.length} clubs`);
  return pairs.length;
}

interface Binding { [k: string]: { value: string } | undefined; }

async function wdSparql(query: string): Promise<Binding[]> {
  const res = await fetch(WD_ENDPOINT, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      Accept: "application/sparql-results+json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `query=${encodeURIComponent(query)}&format=json`,
  });
  if (!res.ok) throw new Error(`SPARQL HTTP ${res.status}`);
  const json = (await res.json()) as { results: { bindings: Binding[] } };
  return json.results.bindings;
}

const qidOf = (uri: string) => uri.split("/").pop() ?? uri;
const fileOf = (uri: string | undefined) => (uri ? uri.split("Special:FilePath/").pop() ?? null : null);

/** Phase 2: Wikidata P154 for any remaining crest-less clubs with a QID id. */
async function enrichFromWikidata(): Promise<number> {
  const clubs = (await sql`
    SELECT id FROM clubs WHERE crest_url IS NULL AND id ~ '^Q[0-9]+$'`) as { id: string }[];
  let matched = 0;
  for (let i = 0; i < clubs.length; i += WD_BATCH) {
    const batch = clubs.slice(i, i + WD_BATCH);
    const values = batch.map((c) => `wd:${c.id}`).join(" ");
    const bindings = await wdSparql(
      `SELECT ?club ?crest WHERE { VALUES ?club { ${values} } ?club wdt:P154 ?crest }`
    );
    const pairs: { id: string; url: string }[] = [];
    for (const b of bindings) {
      const file = fileOf(b.crest?.value);
      if (file) pairs.push({ id: qidOf(b.club!.value), url: commonsThumbUrl(file, 120) });
    }
    await applyCrests(pairs);
    matched += pairs.length;
    console.log(`[${ts()}] wikidata: ${Math.min(i + WD_BATCH, clubs.length)}/${clubs.length} scanned, ${matched} crests`);
    await sleep(WD_DELAY_MS);
  }
  return matched;
}

async function main() {
  await ensureColumn();
  await enrichFromFootballData();
  await enrichFromWikidata();

  const [{ total }] = (await sql`SELECT COUNT(*)::text AS total FROM clubs`) as [{ total: string }];
  const [{ withCrest }] = (await sql`SELECT COUNT(*)::text AS "withCrest" FROM clubs WHERE crest_url IS NOT NULL`) as [{ withCrest: string }];
  console.log(`[${ts()}] DONE — ${withCrest}/${total} clubs have a crest`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
