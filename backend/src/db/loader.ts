import { Client } from "pg";
import QueryStream from "pg-query-stream";
import { sql } from "./connection.js";
import { directUrl } from "./pg-url.js";
import type { Player } from "../types/player.js";
import type { BipartiteGraph, ClubSeasonNode } from "../types/graph.js";
import { crestUrl } from "../utils/image.js";

/** Transfermarkt season is a start year ("2024"); render as "2024-25". */
function seasonLabel(startYear: string | null): string {
  const y = parseInt(String(startYear), 10);
  return Number.isFinite(y) ? `${y}-${String((y + 1) % 100).padStart(2, "0")}` : String(startYear ?? "");
}

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
        imageUrl: r.image_url ?? undefined,
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
        `SELECT gl.player_id, gl.game_id, gl.club_id, c.name AS club, g.season, to_char(g.date,'YYYY-MM-DD') AS date
         FROM game_lineups gl
         JOIN games g ON g.id = gl.game_id
         JOIN clubs c ON c.id = gl.club_id`,
        [],
        { batchSize: 10000 }
      )
    );

    let rows = 0;
    for await (const row of stream as AsyncIterable<{ player_id: string; game_id: string; club_id: string; club: string; season: string; date: string | null }>) {
      const season = seasonLabel(row.season);
      const key = `${row.game_id}::${row.club_id}`;
      let node = nodeByKey.get(key);
      if (!node) {
        node = { gameId: row.game_id, club: row.club, clubId: row.club_id, season, date: row.date ?? undefined, roster: [] };
        nodeByKey.set(key, node);
      }
      node.roster.push(row.player_id);

      let nodes = playerToSeasons.get(row.player_id);
      if (!nodes) {
        nodes = [];
        playerToSeasons.set(row.player_id, nodes);
      }
      nodes.push(node);

      // Career timeline: distinct club + seasons the player actually appeared in.
      const p = playerMap.get(row.player_id);
      if (p) {
        let stint = p.clubs.find((s) => s.clubId === row.club_id);
        if (!stint) {
          stint = { club: row.club, clubId: row.club_id, seasons: [] };
          p.clubs.push(stint);
        }
        if (!stint.seasons.includes(season)) stint.seasons.push(season);
      }

      if (++rows % 500000 === 0) console.log(`📄 ${rows.toLocaleString()} lineup rows…`);
    }

    // Surface the most recent shared game first when reconstructing a path.
    for (const nodes of playerToSeasons.values()) {
      nodes.sort((a, b) => b.season.localeCompare(a.season) || (b.date ?? "").localeCompare(a.date ?? ""));
    }
    for (const p of playerMap.values()) {
      p.clubs.sort((a, b) => (b.seasons[0] ?? "").localeCompare(a.seasons[0] ?? ""));
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
