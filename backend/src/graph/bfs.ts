import type { Player } from "../types/player.js";
import type { AdjacencyList, SeparationResult, PathStep } from "../types/graph.js";

interface ParentEntry {
  parentId: string | null;
  club: string;
  season: string;
}

export function findShortestPath(
  graph: AdjacencyList,
  startId: string,
  endId: string,
  playerLookup: Map<string, Player>
): SeparationResult | null {
  if (!graph.has(startId) || !graph.has(endId)) {
    return null;
  }

  if (startId === endId) {
    const player = playerLookup.get(startId)!;
    return {
      found: true,
      separationNumber: 0,
      path: [{ player: player.name, playerId: player.id, club: "", season: "" }],
    };
  }

  const visited = new Set<string>([startId]);
  const parent = new Map<string, ParentEntry>();
  parent.set(startId, { parentId: null, club: "", season: "" });

  const queue: string[] = [startId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const edges = graph.get(current);
    if (!edges) continue;

    for (const edge of edges) {
      if (visited.has(edge.playerId)) continue;
      visited.add(edge.playerId);

      const bestRef = pickBestClubSeason(edge.sharedClubSeasons);
      parent.set(edge.playerId, {
        parentId: current,
        club: bestRef.club,
        season: bestRef.season,
      });

      if (edge.playerId === endId) {
        return reconstructPath(parent, startId, endId, playerLookup);
      }

      queue.push(edge.playerId);
    }
  }

  return { found: false, separationNumber: -1, path: [] };
}

function pickBestClubSeason(
  refs: { club: string; season: string }[]
): { club: string; season: string } {
  return refs.sort((a, b) => b.season.localeCompare(a.season))[0];
}

function reconstructPath(
  parent: Map<string, ParentEntry>,
  startId: string,
  endId: string,
  playerLookup: Map<string, Player>
): SeparationResult {
  const path: PathStep[] = [];
  let current: string | null = endId;

  while (current !== null) {
    const entry: ParentEntry = parent.get(current)!;
    const player = playerLookup.get(current)!;
    path.push({
      player: player.name,
      playerId: player.id,
      club: entry.club,
      season: entry.season,
    });
    current = entry.parentId;
  }

  path.reverse();

  return {
    found: true,
    separationNumber: path.length - 1,
    path,
  };
}
