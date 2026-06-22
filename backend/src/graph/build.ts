import type { Player } from "../types/player.js";
import type { BipartiteGraph, ClubSeasonNode } from "../types/graph.js";

export function buildGraph(players: Player[]): BipartiteGraph {
  // One shared node object per (club, season). Players reference these nodes,
  // so a roster is stored exactly once no matter how many players are in it.
  const nodeByKey = new Map<string, ClubSeasonNode>();
  const playerToSeasons = new Map<string, ClubSeasonNode[]>();

  for (const player of players) {
    // Register every player as a node, even if they never share a club-season,
    // so isolated players are still found (and return "not found" rather than null).
    let nodes = playerToSeasons.get(player.id);
    if (!nodes) {
      nodes = [];
      playerToSeasons.set(player.id, nodes);
    }

    for (const stint of player.clubs) {
      for (const season of stint.seasons) {
        // Key on the club id when present (QID identity is exact); fall back to
        // the display name for seed data that has no id.
        // Fallback/test path has no real games: one synthetic hub per club-season.
        const club = stint.clubId ?? stint.club;
        const gameId = `${club}::${season}`;
        const key = `${gameId}::${club}`; // matches hubKey(node) used everywhere
        let node = nodeByKey.get(key);
        if (!node) {
          node = { gameId, club: stint.club, clubId: stint.clubId, season, roster: [] };
          nodeByKey.set(key, node);
        }
        node.roster.push(player.id);
        nodes.push(node);
      }
    }
  }

  // Sort each player's nodes by season descending so BFS discovers teammates via
  // their most recent shared season first — that's the connection we surface.
  for (const nodes of playerToSeasons.values()) {
    nodes.sort((a, b) => b.season.localeCompare(a.season));
  }

  return { playerToSeasons, clubSeasonIndex: nodeByKey };
}
