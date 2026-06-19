import type { Player } from "../types/player.js";
import type { BipartiteGraph, SeparationResult, PathStep } from "../types/graph.js";

interface ParentEntry {
  parentId: string | null;
  club: string;
  clubId?: string;
  season: string;
}

export function findShortestPath(
  graph: BipartiteGraph,
  startId: string,
  endId: string,
  playerLookup: Map<string, Player>
): SeparationResult | null {
  const { playerToSeasons } = graph;

  if (!playerToSeasons.has(startId) || !playerToSeasons.has(endId)) {
    return null;
  }

  if (startId === endId) {
    const player = playerLookup.get(startId)!;
    return {
      found: true,
      separationNumber: 0,
      path: [
        {
          player: player.name,
          playerId: player.id,
          playerWikidataId: player.wikidataId ?? null,
          club: "",
          clubId: null,
          season: "",
        },
      ],
    };
  }

  const visited = new Set<string>([startId]);
  const parent = new Map<string, ParentEntry>();
  parent.set(startId, { parentId: null, club: "", season: "" });

  // Head-index queue rather than Array.shift() — shift() is O(n), which would
  // make BFS O(n²) on the full ~224k-player graph.
  const queue: string[] = [startId];
  let head = 0;

  while (head < queue.length) {
    const current = queue[head++];

    // Expand through each club-season node the player belongs to; everyone in
    // that node's roster is a direct teammate.
    for (const node of playerToSeasons.get(current)!) {
      for (const teammateId of node.roster) {
        if (visited.has(teammateId)) continue;
        visited.add(teammateId);

        parent.set(teammateId, {
          parentId: current,
          club: node.club,
          clubId: node.clubId,
          season: node.season,
        });

        if (teammateId === endId) {
          return reconstructPath(parent, startId, endId, playerLookup);
        }

        queue.push(teammateId);
      }
    }
  }

  return { found: false, separationNumber: -1, path: [] };
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
      playerWikidataId: player.wikidataId ?? null,
      club: entry.club,
      clubId: entry.clubId ?? null,
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
