import { sql } from "./connection.js";
import type { Player, ClubStint } from "../types/player.js";

interface Row {
  id: string;
  name: string;
  date_of_birth: string | null;
  nationality: string | null;
  club_id: string;
  club_name: string;
  season: string;
}

export async function loadPlayersFromDb(): Promise<Player[]> {
  const playerMap = new Map<string, Player>();
  const PAGE = 50000;

  // Cursor-paginate on the full ORDER BY tuple so a player's rows can span page
  // boundaries without loss — a single query over ~1M+ join rows would be slow
  // and can be truncated by the serverless HTTP driver. Accumulating into a Map
  // means split players merge correctly.
  let cId = "";
  let cClub = "";
  let cSeason = "";
  for (;;) {
    const rows = (await sql`
      SELECT
        p.id,
        p.name,
        to_char(p.date_of_birth, 'YYYY-MM-DD') AS date_of_birth,
        p.nationality,
        pcs.club_id,
        c.name AS club_name,
        pcs.season
      FROM players p
      JOIN player_club_seasons pcs ON p.id = pcs.player_id
      JOIN clubs c ON pcs.club_id = c.id
      WHERE (p.id, pcs.club_id, pcs.season) > (${cId}, ${cClub}, ${cSeason})
      ORDER BY p.id, pcs.club_id, pcs.season
      LIMIT ${PAGE}
    `) as (Row & { club_id: string })[];
    if (rows.length === 0) break;

    for (const row of rows) {
      let player = playerMap.get(row.id);
      if (!player) {
        player = {
          id: row.id,
          name: row.name,
          dateOfBirth: row.date_of_birth ?? undefined,
          nationality: row.nationality ?? undefined,
          clubs: [],
        };
        playerMap.set(row.id, player);
      }

      let stint = player.clubs.find((s) => s.club === row.club_name);
      if (!stint) {
        stint = { club: row.club_name, seasons: [] };
        player.clubs.push(stint);
      }
      if (!stint.seasons.includes(row.season)) {
        stint.seasons.push(row.season);
      }
    }

    const last = rows[rows.length - 1];
    cId = last.id;
    cClub = last.club_id;
    cSeason = last.season;
    if (rows.length < PAGE) break;
  }

  return [...playerMap.values()];
}

export async function getPlayerCount(): Promise<number> {
  const rows = (await sql`SELECT COUNT(*)::text AS count FROM players`) as [{ count: string }];
  return parseInt(rows[0].count, 10);
}
