import { Client } from "pg";
import QueryStream from "pg-query-stream";
import { sql } from "./connection.js";
import { directUrl } from "./pg-url.js";
import type { Player } from "../types/player.js";
import type { BipartiteGraph, ClubSeasonNode } from "../types/graph.js";
import { crestUrl, bigPortrait } from "../utils/image.js";
import { ingestLineupRow, type LineupRow } from "./lineup-ingest.js";
import { markLoanStints } from "../utils/loans.js";

/**
 * Loads the whole dataset and builds the co-appearance graph in one streaming
 * pass. Each `game_lineups` row places a player in a club's matchday squad for a
 * game; the hub is keyed `${gameId}::${clubId}`, so two players share a hub iff
 * they were named in the same squad — every edge is a real teammate relationship.
 *
 * Uses a direct `pg` connection + server-side cursor (pg-query-stream) rather
 * than the serverless HTTP driver, so the ~2.4M-row join streams in one query
 * instead of hundreds of paginated round-trips.
 */
export async function loadGraph(): Promise<{ players: Player[]; graph: BipartiteGraph }> {
  const client = new Client({ connectionString: directUrl(process.env.DATABASE_URL!), ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    console.log("📦 Loading players…");
    const playerMap = new Map<string, Player>();
    const pres = await client.query(
      `SELECT id, name, to_char(date_of_birth,'YYYY-MM-DD') AS dob, nationality, image_url, popularity FROM players`
    );
    for (const r of pres.rows) {
      playerMap.set(r.id, {
        id: r.id,
        name: r.name,
        dateOfBirth: r.dob ?? undefined,
        nationality: r.nationality ?? undefined,
        imageUrl: bigPortrait(r.image_url),
        popularity: r.popularity ?? undefined,
        clubs: [],
      });
    }
    console.log(`📦 ${playerMap.size} players; streaming lineups…`);

    const nodeByKey = new Map<string, ClubSeasonNode>();
    const playerToSeasons = new Map<string, ClubSeasonNode[]>();
    for (const id of playerMap.keys()) playerToSeasons.set(id, []);

    const stream = client.query(
      new QueryStream(
        `SELECT gl.player_id, gl.game_id, gl.club_id, c.name AS club, g.season, to_char(g.date,'YYYY-MM-DD') AS date, g.competition_id
         FROM game_lineups gl
         JOIN games g ON g.id = gl.game_id
         JOIN clubs c ON c.id = gl.club_id`,
        [],
        { batchSize: 10000 }
      )
    );

    let rows = 0;
    let skipped = 0;
    for await (const row of stream as AsyncIterable<LineupRow>) {
      if (!ingestLineupRow(row, playerMap, nodeByKey, playerToSeasons)) skipped++;
      if (++rows % 500000 === 0) console.log(`📄 ${rows.toLocaleString()} lineup rows…`);
    }
    if (skipped) console.warn(`⚠️  skipped ${skipped.toLocaleString()} dangling lineup rows (player_id not in players — run pruneDanglingLineups)`);

    // Surface the most recent shared game first when reconstructing a path.
    for (const nodes of playerToSeasons.values()) {
      nodes.sort((a, b) => b.season.localeCompare(a.season) || (b.date ?? "").localeCompare(a.date ?? ""));
    }
    for (const p of playerMap.values()) {
      p.clubs.sort((a, b) => (b.seasons[0] ?? "").localeCompare(a.seasons[0] ?? ""));
      markLoanStints(p.clubs);
    }

    console.log(`✨ graph built: ${playerMap.size} players, ${nodeByKey.size} squad nodes, ${rows.toLocaleString()} appearances`);
    return { players: [...playerMap.values()], graph: { playerToSeasons, clubSeasonIndex: nodeByKey } };
  } finally {
    await client.end();
  }
}

export async function getPlayerCount(): Promise<number> {
  const rows = (await sql`SELECT COUNT(*)::text AS count FROM players`) as [{ count: string }];
  return parseInt(rows[0].count, 10);
}

export interface ClubInfo {
  name: string;
  crestUrl?: string;
}

/** Load all clubs (id -> name + derived crest) into memory at boot. */
export async function loadClubs(): Promise<Map<string, ClubInfo>> {
  const rows = (await sql`SELECT id, name FROM clubs`) as { id: string; name: string }[];
  const map = new Map<string, ClubInfo>();
  for (const r of rows) map.set(r.id, { name: r.name, crestUrl: crestUrl(r.id) });
  return map;
}
