import type { Player } from "../types/player.js";
import type { ClubSeasonNode } from "../types/graph.js";

// Pure graph-accumulation logic, kept free of the DB connection module so it can
// be unit-tested without a DATABASE_URL. loader.ts drives it over a live stream.

/** Transfermarkt season is a start year ("2024"); render as "2024-25". */
export function seasonLabel(startYear: string | null): string {
  const y = parseInt(String(startYear), 10);
  return Number.isFinite(y) ? `${y}-${String((y + 1) % 100).padStart(2, "0")}` : String(startYear ?? "");
}

/** One streamed `game_lineups` row joined to its game + club. */
export interface LineupRow {
  player_id: string;
  game_id: string;
  club_id: string;
  club: string;
  season: string;
  date: string | null;
  competition_id: string | null;
}

/**
 * Fold one lineup row into the graph under construction. Returns `false` (and
 * mutates nothing) when the row's `player_id` has no `players` row — a "dangling"
 * lineup left behind by importer profiles that were skipped (blank name) or
 * deduped away. Without this guard those ids would become phantom roster members
 * and false teammate hubs, since the whole squad shares a node. Callers should
 * still run `pruneDanglingLineups` after import to drop them at the source.
 */
export function ingestLineupRow(
  row: LineupRow,
  playerMap: Map<string, Player>,
  nodeByKey: Map<string, ClubSeasonNode>,
  playerToSeasons: Map<string, ClubSeasonNode[]>
): boolean {
  const p = playerMap.get(row.player_id);
  if (!p) return false; // dangling lineup — no real player behind this id

  const season = seasonLabel(row.season);
  const key = `${row.game_id}::${row.club_id}`;
  let node = nodeByKey.get(key);
  if (!node) {
    node = { gameId: row.game_id, club: row.club, clubId: row.club_id, season, date: row.date ?? undefined, competition: row.competition_id ?? undefined, roster: [] };
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
  let stint = p.clubs.find((s) => s.clubId === row.club_id);
  if (!stint) {
    stint = { club: row.club, clubId: row.club_id, seasons: [] };
    p.clubs.push(stint);
  }
  if (!stint.seasons.includes(season)) stint.seasons.push(season);
  return true;
}
