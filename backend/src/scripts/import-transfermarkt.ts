/**
 * Rebuilds the database from the open Transfermarkt dataset
 * (github.com/dcaribou/transfermarkt-datasets), the precise replacement for the
 * noisy Wikidata import. Teammate edges come from `game_lineups` — two players
 * named in the same club's matchday squad for a game — so a connection is only
 * ever shown if they were genuinely in the squad together.
 *
 * The published CSVs cover top divisions only (32 first-tier leagues + cups +
 * continental). We ingest `domestic_league` + `international_cup` by default
 * (TM_COMP_TYPES); English lower tiers (EFL) come later via the TM scraper.
 *
 * Streams each gzipped CSV from the public CDN straight into Postgres via COPY
 * (fast, low-memory). Idempotent: drops + recreates the tables each run.
 *
 * Run: DATABASE_URL=... npm run import:tm --workspace=backend
 */
import { Client } from "pg";
import { from as copyFrom } from "pg-copy-streams";
import { parse } from "csv-parse";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { once } from "node:events";
import { finished } from "node:stream/promises";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const BASE = process.env.TM_DATA_BASE ?? "https://pub-e682421888d945d684bcae8890b0ec20.r2.dev/data";
const COMP_TYPES = new Set(
  (process.env.TM_COMP_TYPES ?? "domestic_league,international_cup").split(",").map((s) => s.trim())
);

const ts = () => new Date().toISOString().slice(11, 19);
const day = (v: string | undefined) => (v ? v.slice(0, 10) || null : null) ?? "";

/** CSV cell for COPY (FORMAT csv, NULL ''): empty → NULL, quote when needed. */
function cell(v: string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "";
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

async function ensureSchema(client: Client) {
  await client.query(`
    DROP TABLE IF EXISTS game_lineups, games, player_club_seasons, player_external_ids,
      import_jobs, import_club_queue, players, clubs CASCADE;

    CREATE TABLE clubs (
      id   TEXT PRIMARY KEY,           -- Transfermarkt club_id
      name TEXT NOT NULL
    );
    CREATE TABLE players (
      id            TEXT PRIMARY KEY,  -- Transfermarkt player_id
      name          TEXT NOT NULL,
      date_of_birth DATE,
      nationality   TEXT,
      image_url     TEXT,             -- Transfermarkt portrait (faces)
      market_value  BIGINT,           -- highest career market value, EUR
      popularity    REAL              -- ln(1+market_value), search ranking
    );
    CREATE TABLE games (
      id              TEXT PRIMARY KEY,
      competition_id  TEXT,
      season          TEXT,            -- start year, e.g. "2024" (= 2024-25)
      date            DATE,
      home_club_id    TEXT,
      away_club_id    TEXT,
      home_club_name  TEXT,
      away_club_name  TEXT
    );
    -- The edge source: a player named in a club's matchday squad for a game.
    -- No PK (source may hold dupes); the graph build de-dupes.
    CREATE TABLE game_lineups (
      game_id   TEXT NOT NULL,
      club_id   TEXT NOT NULL,
      player_id TEXT NOT NULL,
      type      TEXT                   -- starting | substitutes
    );
  `);
}

/** Stream a gzipped CSV from the CDN into `table` via COPY, mapping each record
 *  to a row (or null to skip). `mapFn` may also collect ids into Sets. */
async function copyInto(
  client: Client,
  table: string,
  cols: string[],
  file: string,
  mapFn: (r: Record<string, string>) => (string | null)[] | null
): Promise<number> {
  const copy = client.query(copyFrom(`COPY ${table} (${cols.join(",")}) FROM STDIN WITH (FORMAT csv, NULL '')`));
  const res = await fetch(`${BASE}/${file}.csv.gz`);
  if (!res.ok || !res.body) throw new Error(`fetch ${file}: ${res.status}`);
  const parser = (Readable.fromWeb(res.body as never) as Readable)
    .pipe(createGunzip())
    .pipe(parse({ columns: true, relax_quotes: true, skip_records_with_error: true }));

  let n = 0;
  try {
    for await (const rec of parser) {
      const row = mapFn(rec as Record<string, string>);
      if (!row) continue;
      if (!copy.write(row.map(cell).join(",") + "\n")) await once(copy, "drain");
      n++;
      if (n % 250000 === 0) console.log(`[${ts()}]   ${table}: ${n.toLocaleString()} rows…`);
    }
  } finally {
    copy.end();
  }
  await finished(copy);
  return n;
}

async function main() {
  const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log(`[${ts()}] connected; comp types: ${[...COMP_TYPES].join(", ")}`);

  await ensureSchema(client);
  console.log(`[${ts()}] schema ready`);

  // 1) games — filter to in-scope competitions; collect game + club ids.
  const gameIds = new Set<string>();
  const clubIds = new Set<string>();
  const games = await copyInto(client, "games",
    ["id", "competition_id", "season", "date", "home_club_id", "away_club_id", "home_club_name", "away_club_name"],
    "games",
    (r) => {
      if (!COMP_TYPES.has(r.competition_type)) return null;
      gameIds.add(r.game_id);
      if (r.home_club_id) clubIds.add(r.home_club_id);
      if (r.away_club_id) clubIds.add(r.away_club_id);
      return [r.game_id, r.competition_id, r.season, day(r.date), r.home_club_id, r.away_club_id, r.home_club_name, r.away_club_name];
    });
  console.log(`[${ts()}] games: ${games.toLocaleString()} in scope (${clubIds.size} clubs)`);

  // 2) game_lineups — only for in-scope games; collect player ids.
  const playerIds = new Set<string>();
  const lineups = await copyInto(client, "game_lineups",
    ["game_id", "club_id", "player_id", "type"],
    "game_lineups",
    (r) => {
      if (!gameIds.has(r.game_id)) return null;
      playerIds.add(r.player_id);
      return [r.game_id, r.club_id, r.player_id, r.type];
    });
  console.log(`[${ts()}] game_lineups: ${lineups.toLocaleString()} rows (${playerIds.size} players)`);

  // 3) players — only those who appear in scope.
  const players = await copyInto(client, "players",
    ["id", "name", "date_of_birth", "nationality", "image_url", "market_value"],
    "players",
    (r) => {
      if (!playerIds.has(r.player_id)) return null;
      const name = r.name || `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim();
      if (!name) return null;
      return [r.player_id, name, day(r.date_of_birth) || null, r.country_of_citizenship, r.image_url, r.highest_market_value_in_eur || null];
    });
  console.log(`[${ts()}] players: ${players.toLocaleString()}`);

  // 4) clubs — only those in scope.
  const clubs = await copyInto(client, "clubs",
    ["id", "name"],
    "clubs",
    (r) => (clubIds.has(r.club_id) ? [r.club_id, r.name] : null));
  console.log(`[${ts()}] clubs: ${clubs.toLocaleString()}`);

  // Indexes + derived popularity.
  console.log(`[${ts()}] indexing + computing popularity…`);
  await client.query(`CREATE INDEX idx_gl_game_club ON game_lineups (game_id, club_id)`);
  await client.query(`CREATE INDEX idx_gl_player ON game_lineups (player_id)`);
  await client.query(`UPDATE players SET popularity = ln(1 + COALESCE(market_value, 0))`);

  console.log(`[${ts()}] DONE — ${players.toLocaleString()} players, ${clubs.toLocaleString()} clubs, ${games.toLocaleString()} games, ${lineups.toLocaleString()} lineup rows`);
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
