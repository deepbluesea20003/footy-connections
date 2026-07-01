/**
 * Extends the dataset with lineups the open Transfermarkt CSVs don't cover —
 * lower tiers (English EFL etc.) and, above all, HISTORICAL depth: pre-2012
 * big-5 seasons the published CSVs stop short of — by scraping matchday lineups
 * directly from Transfermarkt.
 *
 * Identity fusion goes through reep, exactly like import-transfermarkt.ts. Both
 * scripts read Transfermarkt's own numeric ids, but those are canonicalized via
 * `canonicalId(reep, "transfermarkt", tmId)` before they touch `players` /
 * `game_lineups` — yielding a shared `reep_…` id when reep knows the player (so
 * the same person collapses to one node across CSV import + scrape) or a
 * `tr:<tmId>` fallback otherwise. Writing bare numeric ids here (as an earlier
 * version did) created DISJOINT nodes that never linked to a player's modern
 * self, so we must mirror the importer's canonicalization. If the reep tables
 * are absent we warn and fall back to canonicalId's `tr:` prefix — never a bare
 * numeric id.
 *
 * Edge basis stays co-appearance: two players named in the same club's matchday
 * squad for a game. For each competition+season it reads the fixtures page for
 * match ids, then each match's lineup page for the squads.
 *
 * Scraped `games`/`game_lineups` share the raw TM match-id space with the CSV
 * import, so `ON CONFLICT (id) DO NOTHING` de-dupes cleanly. Scraped games are
 * stamped `source = 'tm-scrape'` (the CSV importer uses 'tm') so the two are
 * distinguishable.
 *
 * Polite + resumable: rate-limited, and matches already in `games` are skipped,
 * so it can be killed and re-run. Scraping is heavy and ToS-grey — run it as a
 * background job, not casually.
 *
 * Config (env): TM_SCRAPE_COMPS (default EFL: GB2,GB3,GB4), TM_SCRAPE_SEASONS
 * (e.g. "2021-2023" or "2023"), TM_SCRAPE_DELAY_MS, TM_SCRAPE_MATCH_LIMIT.
 *
 * Run: DATABASE_URL=... npm run scrape:tm --workspace=backend
 */
import { Client } from "pg";
import { loadReepMaps, canonicalId, type ReepMaps } from "../db/reep.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const BASE = "https://www.transfermarkt.com";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
const COMPS = (process.env.TM_SCRAPE_COMPS ?? "GB2,GB3,GB4").split(",").map((s) => s.trim());
const DELAY_MS = Number(process.env.TM_SCRAPE_DELAY_MS ?? 2500);
const MATCH_LIMIT = Number(process.env.TM_SCRAPE_MATCH_LIMIT ?? Infinity);

function seasons(): number[] {
  const spec = process.env.TM_SCRAPE_SEASONS ?? "2023";
  if (spec.includes("-")) {
    const [a, b] = spec.split("-").map((n) => parseInt(n, 10));
    return Array.from({ length: b - a + 1 }, (_, i) => a + i);
  }
  return [parseInt(spec, 10)];
}

const ts = () => new Date().toISOString().slice(11, 19);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** reep maps (canonical identity), loaded if load-reep.ts has run; else null.
 *  Mirrors import-transfermarkt.ts so scraped players fuse with CSV-imported
 *  ones instead of forming disjoint nodes. */
async function tryLoadReep(client: Client): Promise<ReepMaps | null> {
  try {
    const maps = await loadReepMaps(client);
    console.log(`[${ts()}] reep: ${maps.toReep.size.toLocaleString()} id mappings loaded`);
    return maps;
  } catch {
    console.warn(`[${ts()}] reep tables not found — using source-prefixed ids (run load:reep first to fuse sources)`);
    return null;
  }
}
const titleize = (slug: string) =>
  slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();

async function fetchHtml(url: string, attempt = 1): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Referer: `${BASE}/` } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (e) {
    if (attempt >= 3) {
      console.warn(`[${ts()}]   fetch failed ${url}: ${(e as Error).message}`);
      return null;
    }
    await sleep(DELAY_MS * attempt * 2);
    return fetchHtml(url, attempt + 1);
  }
}

interface Fixture { matchId: string; homeName: string; awayName: string }

/** Match ids (+ club name slugs) for a competition season from its fixtures page. */
function parseFixtures(html: string): Fixture[] {
  const seen = new Map<string, Fixture>();
  const re = /href="\/([a-z0-9-]+)_([a-z0-9-]+)\/index\/spielbericht\/(\d+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (!seen.has(m[3])) seen.set(m[3], { matchId: m[3], homeName: titleize(m[1]), awayName: titleize(m[2]) });
  }
  return [...seen.values()];
}

interface LineupRow { clubId: string; playerId: string; name: string; imageUrl: string | null; type: string }
interface Lineup { homeClubId: string; awayClubId: string; rows: LineupRow[] }

/** Parse a match lineup page. The page is four sections in order — home
 *  starting, away starting, home subs, away subs — each preceded by its
 *  `/verein/{id}` and a "Starting Line-Up"/"Substitutes" header. */
function parseLineup(html: string): Lineup | null {
  const anchorRe = /\/verein\/(\d+)[\s\S]{0,600}?(Starting Line-?Up|Substitutes)/gi;
  const anchors: { pos: number; clubId: string; type: string }[] = [];
  let a: RegExpExecArray | null;
  while ((a = anchorRe.exec(html))) {
    anchors.push({ pos: a.index, clubId: a[1], type: /sub/i.test(a[2]) ? "substitutes" : "starting" });
  }
  if (anchors.length < 2) return null;

  const rows: LineupRow[] = [];
  const playerRe = /\/([a-z0-9-]+)\/profil\/spieler\/(\d+)/g;
  for (let i = 0; i < anchors.length; i++) {
    const start = anchors[i].pos;
    const end = i + 1 < anchors.length ? anchors[i + 1].pos : html.length;
    const cap = anchors[i].type === "starting" ? 11 : 14; // bound against trailing links
    const section = html.slice(start, end);
    playerRe.lastIndex = 0;
    let p: RegExpExecArray | null;
    const seen = new Set<string>();
    while ((p = playerRe.exec(section)) && seen.size < cap) {
      if (seen.has(p[2])) continue;
      seen.add(p[2]);
      // Photo, if present in the next bit of markup after the link.
      const img = /<img[^>]+src="(https:\/\/img\.a\.transfermarkt[^"]+)"/.exec(section.slice(p.index, p.index + 300));
      rows.push({ clubId: anchors[i].clubId, playerId: p[2], name: titleize(p[1]), imageUrl: img?.[1] ?? null, type: anchors[i].type });
    }
  }
  if (rows.length === 0) return null;
  const homeClubId = anchors[0].clubId;
  const awayClubId = anchors.find((x) => x.clubId !== homeClubId)?.clubId ?? homeClubId;
  return { homeClubId, awayClubId, rows };
}

async function main() {
  const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log(`[${ts()}] scraping comps ${COMPS.join(",")} seasons ${seasons().join(",")}`);

  const reep = await tryLoadReep(client);
  const canon = (tmId: string) => canonicalId(reep, "transfermarkt", tmId);

  let scraped = 0;
  for (const comp of COMPS) {
    for (const season of seasons()) {
      const fixturesUrl = `${BASE}/-/gesamtspielplan/wettbewerb/${comp}/saison_id/${season}`;
      const fxHtml = await fetchHtml(fixturesUrl);
      await sleep(DELAY_MS);
      if (!fxHtml) {
        console.warn(`[${ts()}] ${comp} ${season}: no fixtures page`);
        continue;
      }
      const fixtures = parseFixtures(fxHtml);
      console.log(`[${ts()}] ${comp} ${season}: ${fixtures.length} matches`);

      for (const fx of fixtures) {
        if (scraped >= MATCH_LIMIT) break;
        const { rows: exists } = await client.query("SELECT 1 FROM games WHERE id = $1", [fx.matchId]);
        if (exists.length) continue;

        const luHtml = await fetchHtml(`${BASE}/-/aufstellung/spielbericht/${fx.matchId}`);
        await sleep(DELAY_MS);
        const lineup = luHtml && parseLineup(luHtml);
        if (!lineup) continue;

        // clubs (names from fixtures slug; don't overwrite proper CSV names)
        await client.query(
          `INSERT INTO clubs (id, name) VALUES ($1,$2),($3,$4) ON CONFLICT (id) DO NOTHING`,
          [lineup.homeClubId, fx.homeName, lineup.awayClubId, fx.awayName]
        );
        // game (source distinguishes scraped rows from the CSV import's 'tm')
        await client.query(
          `INSERT INTO games (id, competition_id, season, home_club_id, away_club_id, home_club_name, away_club_name, source)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
          [fx.matchId, comp, String(season), lineup.homeClubId, lineup.awayClubId, fx.homeName, fx.awayName, "tm-scrape"]
        );
        // players + lineups — canonicalize the raw TM id through reep so scraped
        // players fuse with their CSV selves (ON CONFLICT keeps richer CSV rows).
        for (const r of lineup.rows) {
          const pid = canon(r.playerId);
          await client.query(
            `INSERT INTO players (id, name, image_url) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING`,
            [pid, r.name, r.imageUrl]
          );
          await client.query(
            `INSERT INTO game_lineups (game_id, club_id, player_id, type) VALUES ($1,$2,$3,$4)`,
            [fx.matchId, r.clubId, pid, r.type]
          );
        }
        scraped++;
        if (scraped % 25 === 0) console.log(`[${ts()}]   scraped ${scraped} matches…`);
      }
      if (scraped >= MATCH_LIMIT) break;
    }
    if (scraped >= MATCH_LIMIT) break;
  }

  // Give freshly-scraped players a (zero) popularity so search ranks them last.
  await client.query(`UPDATE players SET popularity = ln(1 + COALESCE(market_value,0)) WHERE popularity IS NULL`);
  console.log(`[${ts()}] DONE — scraped ${scraped} matches`);
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
