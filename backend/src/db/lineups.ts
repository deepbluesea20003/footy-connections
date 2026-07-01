import type { Client } from "pg";

/**
 * Delete `game_lineups` rows whose `player_id` has no matching `players` row.
 *
 * These "dangling" lineups are written by the importers keyed on a canonical id,
 * but the corresponding `players` row is sometimes never emitted — e.g. a
 * blank-name Transfermarkt profile is skipped, or a canonical id's first-seen
 * profile had no name. Left in place they become phantom roster members / false
 * teammate hubs when the graph is built (see `ingestLineupRow` in loader.ts),
 * since every player named in a squad shares the same node.
 *
 * Idempotent and cheap — run it as the final step of any import. Returns the
 * number of rows removed.
 */
export async function pruneDanglingLineups(client: Client): Promise<number> {
  const res = await client.query(
    `DELETE FROM game_lineups gl
     WHERE NOT EXISTS (SELECT 1 FROM players p WHERE p.id = gl.player_id)`
  );
  return res.rowCount ?? 0;
}
