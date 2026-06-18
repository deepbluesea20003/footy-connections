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
    ORDER BY p.id, c.name, pcs.season
  `) as Row[];

  const playerMap = new Map<string, Player>();

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

  return [...playerMap.values()];
}

export async function getPlayerCount(): Promise<number> {
  const rows = (await sql`SELECT COUNT(*)::text AS count FROM players`) as [{ count: string }];
  return parseInt(rows[0].count, 10);
}
