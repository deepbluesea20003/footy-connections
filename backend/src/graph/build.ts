import type { Player } from "../types/player.js";
import type { AdjacencyList, TeammateEdge, ClubSeasonRef } from "../types/graph.js";

export function buildGraph(players: Player[]): AdjacencyList {
  const clubSeasonIndex = new Map<string, string[]>();

  for (const player of players) {
    for (const stint of player.clubs) {
      for (const season of stint.seasons) {
        const key = `${stint.club}::${season}`;
        let bucket = clubSeasonIndex.get(key);
        if (!bucket) {
          bucket = [];
          clubSeasonIndex.set(key, bucket);
        }
        bucket.push(player.id);
      }
    }
  }

  const graph: AdjacencyList = new Map();
  for (const player of players) {
    graph.set(player.id, []);
  }

  for (const [key, playerIds] of clubSeasonIndex) {
    const [club, season] = key.split("::");
    const ref: ClubSeasonRef = { club, season };

    for (let i = 0; i < playerIds.length; i++) {
      for (let j = i + 1; j < playerIds.length; j++) {
        addBidirectionalEdge(graph, playerIds[i], playerIds[j], ref);
      }
    }
  }

  return graph;
}

function addBidirectionalEdge(
  graph: AdjacencyList,
  a: string,
  b: string,
  ref: ClubSeasonRef
): void {
  addDirectedEdge(graph, a, b, ref);
  addDirectedEdge(graph, b, a, ref);
}

function addDirectedEdge(
  graph: AdjacencyList,
  from: string,
  to: string,
  ref: ClubSeasonRef
): void {
  const edges = graph.get(from)!;
  let edge = edges.find((e) => e.playerId === to);
  if (!edge) {
    edge = { playerId: to, sharedClubSeasons: [] };
    edges.push(edge);
  }
  const already = edge.sharedClubSeasons.some(
    (r) => r.club === ref.club && r.season === ref.season
  );
  if (!already) {
    edge.sharedClubSeasons.push(ref);
  }
}
