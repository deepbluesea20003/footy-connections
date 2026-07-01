/**
 * Adds lower-tier breadth from the open API-Football bulk dataset
 * (github.com/eatpizzanot/soccer-dataset) — 144 leagues across 60+ countries with
 * multiple tiers each (e.g. English Championship/League One/League Two/National
 * League). Same co-appearance model: `fixture_players` gives who was in each
 * club's matchday squad.
 *
 * Runs AFTER import-transfermarkt (which owns top divisions). It ingests only the
 * leagues in AF_LEAGUE_IDS (lower tiers TM doesn't cover) and appends to the same
 * tables, keyed by canonical id (reep). A player who also appears in the TM data —
 * a league-bridging journeyman — collapses to the same node via their shared
 * reep_id, which is what links the lower leagues into the top-flight graph.
 *
 * Idempotent: deletes its own (`af:`-prefixed) rows first, then reloads.
 *
 * Config: AF_LEAGUE_IDS (default English tiers 2-5: 2,3,4,103), AF_MIN_SEASON.
 * Run: DATABASE_URL=... npm run import:af --workspace=backend
 */
import { Client } from "pg";
import { from as copyFrom } from "pg-copy-streams";
import { parse } from "csv-parse";
import { Readable } from "node:stream";
import { createReadStream, createWriteStream, existsSync, statSync } from "node:fs";
import { once } from "node:events";
import { finished } from "node:stream/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadReepMaps, canonicalId, type ReepMaps } from "../db/reep.js";
import { pruneDanglingLineups } from "../db/lineups.js";
import { directUrl } from "../db/pg-url.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const BASE = process.env.AF_DATA_BASE ?? "https://raw.githubusercontent.com/eatpizzanot/soccer-dataset/main/csv";
const FIXTURE_PLAYERS_URL =
  process.env.AF_FIXTURE_PLAYERS_URL ??
  "https://media.githubusercontent.com/media/eatpizzanot/soccer-dataset/main/csv/fixture_players.csv";
// Lower tiers TM's top-division CSVs don't cover, across major footballing
// nations (2nd/3rd tiers). Top divisions are intentionally excluded (TM owns
// them — no overlap). Override with AF_LEAGUE_IDS to widen/narrow.
//   ENG: Championship 2, League One 3, League Two 4, National League 103
//   ESP Segunda 6 · ITA Serie B 8 · FRA Ligue 2 10, National 1 119
//   GER 2.Bundesliga 12, 3.Liga 106 · NED Eerste Divisie 73 · POR Liga 2 65
//   BEL Challenger 70 · SCO Champ 18, L1 104, L2 105 · TUR 1.Lig 107
//   BRA Série B 57 · ARG Primera Nacional 125 · USA USL Championship 76
const DEFAULT_LEAGUES = "2,3,4,103,6,8,10,119,12,106,73,65,70,18,104,105,107,57,125,76";
const LEAGUES = new Set((process.env.AF_LEAGUE_IDS ?? DEFAULT_LEAGUES).split(",").map((s) => s.trim()));
const MIN_SEASON = Number(process.env.AF_MIN_SEASON ?? 2012);

const ts = () => new Date().toISOString().slice(11, 19);
const cell = (v: string | null | undefined) =>
  v === null || v === undefined || v === "" ? "" : /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
/** English-season start year from a fixture date (Jul–Dec → that year). */
const seasonOf = (date: string) => {
  const y = parseInt(date.slice(0, 4), 10);
  const m = parseInt(date.slice(5, 7), 10);
  return Number.isFinite(y) ? String(m >= 7 ? y : y - 1) : "";
};

/** Download to a local temp file first (cached per run), then parse — a slow
 *  cross-network COPY can't stall the source into an HTTP idle-timeout this way.
 *  Essential for the 577MB fixture_players file. */
async function rows(url: string): Promise<AsyncIterable<Record<string, string>>> {
  const dest = join(tmpdir(), "af-" + url.split("/").pop());
  if (!existsSync(dest) || statSync(dest).size === 0) {
    console.log(`[${ts()}] downloading ${url.split("/").pop()}…`);
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`fetch ${url}: ${res.status}`);
    await finished((Readable.fromWeb(res.body as never) as Readable).pipe(createWriteStream(dest)));
  }
  return createReadStream(dest).pipe(
    parse({ columns: true, relax_quotes: true, skip_records_with_error: true })
  ) as unknown as AsyncIterable<Record<string, string>>;
}

async function main() {
  const client = new Client({ connectionString: directUrl(DATABASE_URL!), ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log(`[${ts()}] leagues ${[...LEAGUES].join(",")}, seasons >= ${MIN_SEASON}`);

  let reep: ReepMaps | null = null;
  try {
    reep = await loadReepMaps(client);
    console.log(`[${ts()}] reep: ${reep.toReep.size.toLocaleString()} id mappings`);
  } catch {
    console.warn(`[${ts()}] reep not loaded — API-Football players won't merge with TM (run load:reep)`);
  }

  // players.csv: dataset player id -> { api_football id, name, nationality, photo }.
  console.log(`[${ts()}] loading players.csv…`);
  const players = new Map<string, { af: string; name: string; nat: string; photo: string }>();
  for await (const r of await rows(`${BASE}/players.csv`)) {
    players.set(r.id, { af: r.api_football_id, name: r.name, nat: r.nationality, photo: r.photo });
  }
  // teams.csv: dataset team id -> name.
  const teams = new Map<string, string>();
  for await (const r of await rows(`${BASE}/teams.csv`)) teams.set(r.id, r.name);
  console.log(`[${ts()}] ${players.size} players, ${teams.size} teams in registry`);

  // Idempotent: clear any previous API-Football layer (TM rows are untouched).
  await client.query(`DELETE FROM game_lineups WHERE game_id LIKE 'af:%'`);
  await client.query(`DELETE FROM games WHERE source = 'api_football'`);

  // 1) fixtures -> games (only target leagues/seasons); collect fixture + team ids.
  const targetFixtures = new Set<string>();
  const teamIds = new Set<string>();
  const gamesCopy = client.query(copyFrom(
    `COPY games (id, competition_id, season, date, home_club_id, away_club_id, home_club_name, away_club_name, source) FROM STDIN WITH (FORMAT csv, NULL '')`
  ));
  let nGames = 0;
  for await (const r of await rows(`${BASE}/fixtures.csv`)) {
    if (!LEAGUES.has(r.league_id)) continue;
    const season = seasonOf(r.date);
    if (!season || Number(season) < MIN_SEASON) continue;
    targetFixtures.add(r.id);
    teamIds.add(r.home_team_id);
    teamIds.add(r.away_team_id);
    const line = [
      `af:${r.id}`, `af:${r.league_id}`, season, r.date.slice(0, 10),
      `af:${r.home_team_id}`, `af:${r.away_team_id}`, teams.get(r.home_team_id) ?? "", teams.get(r.away_team_id) ?? "", "api_football",
    ].map(cell).join(",") + "\n";
    if (!gamesCopy.write(line)) await once(gamesCopy, "drain");
    nGames++;
  }
  gamesCopy.end();
  await finished(gamesCopy);
  console.log(`[${ts()}] games: ${nGames.toLocaleString()} (${targetFixtures.size} fixtures, ${teamIds.size} teams)`);

  // 2) fixture_players (577MB LFS) -> game_lineups for target fixtures; collect
  //    the canonical players that need inserting.
  const need = new Map<string, { name: string; nat: string; photo: string }>();
  const luCopy = client.query(copyFrom(`COPY game_lineups (game_id, club_id, player_id, type) FROM STDIN WITH (FORMAT csv, NULL '')`));
  let nLineups = 0;
  for await (const r of await rows(FIXTURE_PLAYERS_URL)) {
    if (!targetFixtures.has(r.fixture_id)) continue;
    const pl = players.get(r.player_id);
    if (!pl) continue;
    const id = canonicalId(reep, "api_football", pl.af);
    if (!need.has(id)) need.set(id, { name: pl.name || r.player_name, nat: pl.nat, photo: pl.photo });
    const line = [`af:${r.fixture_id}`, `af:${r.team_id}`, id, /^t/i.test(r.is_starter) ? "starting" : "substitutes"]
      .map(cell).join(",") + "\n";
    if (!luCopy.write(line)) await once(luCopy, "drain");
    nLineups++;
    if (nLineups % 500000 === 0) console.log(`[${ts()}]   ${nLineups.toLocaleString()} lineup rows…`);
  }
  luCopy.end();
  await finished(luCopy);
  console.log(`[${ts()}] game_lineups: ${nLineups.toLocaleString()} (${need.size} distinct players)`);

  // 3) players + clubs — ON CONFLICT DO NOTHING so reep-shared (TM) rows win.
  const insertBatched = async (label: string, sql: string, items: unknown[][]) => {
    for (let i = 0; i < items.length; i += 1000) {
      const chunk = items.slice(i, i + 1000);
      const ph = chunk.map((row, j) => `(${row.map((_, k) => `$${j * row.length + k + 1}`).join(",")})`).join(",");
      await client.query(sql.replace("%VALUES%", ph), chunk.flat());
    }
    console.log(`[${ts()}] ${label}: ${items.length.toLocaleString()} upserted`);
  };
  // reep gives DOB for canonical (reep_id) players; af: fallbacks have none.
  const playerRows = [...need].map(([id, p]) => [id, p.name, reep?.meta.get(id)?.dob ?? null, p.nat || null, p.photo || null]);
  await insertBatched("players", `INSERT INTO players (id, name, date_of_birth, nationality, image_url) VALUES %VALUES% ON CONFLICT (id) DO NOTHING`, playerRows);
  const clubRows = [...teamIds].map((tid) => [`af:${tid}`, teams.get(tid) ?? tid]);
  await insertBatched("clubs", `INSERT INTO clubs (id, name) VALUES %VALUES% ON CONFLICT (id) DO NOTHING`, clubRows);

  await client.query(`UPDATE players SET popularity = ln(1 + COALESCE(market_value, 0)) WHERE popularity IS NULL`);

  // Belt-and-braces: drop any lineup (from either source) whose player_id has no
  // players row, so the graph never rosters an unknown id. See db/lineups.ts.
  const pruned = await pruneDanglingLineups(client);
  console.log(`[${ts()}] pruned ${pruned.toLocaleString()} dangling lineup rows`);

  console.log(`[${ts()}] DONE — +${nGames.toLocaleString()} games, +${nLineups.toLocaleString()} lineups, +${need.size.toLocaleString()} players (lower tiers)`);
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
