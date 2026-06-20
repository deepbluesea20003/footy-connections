import { sql } from "./connection.js";
import type { Player, ClubStint } from "../types/player.js";

interface Row {
  id: string;
  name: string;
  date_of_birth: string | null;
  nationality: string | null;
  wikidata_id: string | null;
  image_file: string | null;
  popularity: number | null;
  club_id: string;
  club_name: string;
  season: string;
}

// Neon's serverless HTTP driver has a ~10 MB response limit per query.
// 50K rows × ~200 bytes/row JSON ≈ 10 MB which is right on the edge and
// causes AggregateError on cold starts. 8K rows ≈ 1.6 MB is safely under.
const PAGE = 8000;

async function fetchPage(
  cId: string,
  cClub: string,
  cSeason: string
): Promise<(Row & { club_id: string })[]> {
  const MAX_RETRIES = 4;
  let delay = 1000;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return (await sql`
        SELECT
          p.id,
          p.name,
          to_char(p.date_of_birth, 'YYYY-MM-DD') AS date_of_birth,
          p.nationality,
          p.image_file,
          p.popularity,
          pei.external_id AS wikidata_id,
          pcs.club_id,
          c.name AS club_name,
          pcs.season
        FROM players p
        JOIN player_club_seasons pcs ON p.id = pcs.player_id
        JOIN clubs c ON pcs.club_id = c.id
        LEFT JOIN player_external_ids pei
          ON pei.player_id = p.id AND pei.source = 'wikidata'
        WHERE (p.id, pcs.club_id, pcs.season) > (${cId}, ${cClub}, ${cSeason})
        ORDER BY p.id, pcs.club_id, pcs.season
        LIMIT ${PAGE}
      `) as (Row & { club_id: string })[];
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err;
      console.warn(`⚠️  Page fetch attempt ${attempt} failed (${(err as Error).message}), retrying in ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
      delay *= 2;
    }
  }
  throw new Error("unreachable");
}

export async function loadPlayersFromDb(): Promise<Player[]> {
  const playerMap = new Map<string, Player>();

  console.log("📦 Starting player loading...");

  // Cursor-paginate on the full ORDER BY tuple so a player's rows can span page
  // boundaries without loss — a single query over ~1.9M join rows would exceed
  // Neon's serverless HTTP response limit. Accumulating into a Map means split
  // players merge correctly across page boundaries.
  let cId = "";
  let cClub = "";
  let cSeason = "";
  let totalRowsProcessed = 0;
  let pageCount = 0;

  for (;;) {
    pageCount++;
    const rows = await fetchPage(cId, cClub, cSeason);
    
    if (rows.length === 0) {
      console.log(`✅ Page ${pageCount}: No more rows. Finishing pagination.`);
      break;
    }

    totalRowsProcessed += rows.length;
    console.log(`📄 Page ${pageCount}: Loaded ${rows.length} rows (${totalRowsProcessed} total)`);

    for (const row of rows) {
      let player = playerMap.get(row.id);
      if (!player) {
        player = {
          id: row.id,
          name: row.name,
          dateOfBirth: row.date_of_birth ?? undefined,
          nationality: row.nationality ?? undefined,
          wikidataId: row.wikidata_id ?? undefined,
          imageFile: row.image_file ?? undefined,
          popularity: row.popularity ?? undefined,
          clubs: [],
        };
        playerMap.set(row.id, player);
      }

      let stint = player.clubs.find((s) => s.club === row.club_name);
      if (!stint) {
        stint = { club: row.club_name, clubId: row.club_id, seasons: [] };
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

  const players = [...playerMap.values()];
  console.log(`✨ Loading complete: ${players.length} unique players loaded (${totalRowsProcessed} rows)`);
  
  return players;
}

export async function getPlayerCount(): Promise<number> {
  const rows = (await sql`SELECT COUNT(*)::text AS count FROM players`) as [{ count: string }];
  return parseInt(rows[0].count, 10);
}

export interface ClubInfo {
  name: string;
  crestUrl?: string;
}

/** Load all clubs (id -> name + crest) into memory at boot. ~4.5k rows fit in a
 *  single query; used to attach crests to path steps and squad responses. */
export async function loadClubs(): Promise<Map<string, ClubInfo>> {
  const map = new Map<string, ClubInfo>();
  const rows = (await sql`SELECT id, name, crest_url FROM clubs`) as {
    id: string;
    name: string;
    crest_url: string | null;
  }[];
  for (const r of rows) {
    map.set(r.id, { name: r.name, crestUrl: r.crest_url ?? undefined });
  }
  return map;
}
