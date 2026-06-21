import type { Player } from "../types/player.js";
import type {
  BipartiteGraph,
  ClubSeasonNode,
  SeparationResult,
  PathStep,
  HubCluster,
  BfsLayer,
  ExploreResult,
} from "../types/graph.js";

interface ParentEntry {
  parentId: string | null;
  club: string;
  clubId?: string;
  season: string;
}

/** Stable key for a club-season hub, matching graph.clubSeasonIndex. */
const hubKey = (node: ClubSeasonNode): string => `${node.clubId ?? node.club}::${node.season}`;

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

interface HubAgg {
  club: string;
  clubId?: string;
  season: string;
  depth: number;
  reachedCount: number;
  parentKey: string | null;
}

/**
 * Runs the same BFS as findShortestPath, but also records what it explored and
 * returns an *aggregated* view of it for visualization: the shortest path plus
 * the explored players clustered by the club-season hub they were reached
 * through (the bipartite graph's natural unit). The raw frontier can be 100k+
 * players, so clusters are capped at `maxClusters` (the rest fold into one
 * "+N more clubs" overflow node per depth) — keeping the payload bounded no
 * matter how dense the search was. Edges are the aggregated BFS tree at hub
 * granularity (`parentKey → key`).
 */
export function bfsExplore(
  graph: BipartiteGraph,
  startId: string,
  endId: string,
  playerLookup: Map<string, Player>,
  opts: { maxClusters?: number } = {}
): ExploreResult {
  const { playerToSeasons } = graph;
  const maxClusters = opts.maxClusters ?? (Number(process.env.BFS_MAX_CLUSTERS) || 400);
  const empty: ExploreResult = {
    found: false,
    separationNumber: -1,
    path: [],
    clusters: [],
    layers: [],
    totals: { visitedPlayers: 0, visitedHubs: 0 },
  };

  if (!playerToSeasons.has(startId) || !playerToSeasons.has(endId)) return empty;

  if (startId === endId) {
    const player = playerLookup.get(startId)!;
    return {
      found: true,
      separationNumber: 0,
      path: [{ player: player.name, playerId: player.id, playerWikidataId: player.wikidataId ?? null, club: "", clubId: null, season: "" }],
      clusters: [],
      layers: [{ depth: 0, clubCount: 0, playerCount: 1 }],
      totals: { visitedPlayers: 1, visitedHubs: 0 },
    };
  }

  const visited = new Set<string>([startId]);
  const parent = new Map<string, ParentEntry>([[startId, { parentId: null, club: "", season: "" }]]);
  const depth = new Map<string, number>([[startId, 0]]);
  const viaHub = new Map<string, string | null>([[startId, null]]);
  const hubAgg = new Map<string, HubAgg>();

  const queue: string[] = [startId];
  let head = 0;
  let found = false;

  outer: while (head < queue.length) {
    const current = queue[head++];
    const curDepth = depth.get(current)!;
    const curVia = viaHub.get(current) ?? null;

    for (const node of playerToSeasons.get(current)!) {
      const k = hubKey(node);
      for (const teammateId of node.roster) {
        if (visited.has(teammateId)) continue;
        visited.add(teammateId);
        depth.set(teammateId, curDepth + 1);
        viaHub.set(teammateId, k);
        parent.set(teammateId, { parentId: current, club: node.club, clubId: node.clubId, season: node.season });

        let agg = hubAgg.get(k);
        if (!agg) {
          agg = { club: node.club, clubId: node.clubId, season: node.season, depth: curDepth + 1, reachedCount: 0, parentKey: curVia };
          hubAgg.set(k, agg);
        }
        agg.reachedCount++;

        if (teammateId === endId) {
          found = true;
          break outer;
        }
        queue.push(teammateId);
      }
    }
  }

  let path: PathStep[] = [];
  let separationNumber = -1;
  if (found) {
    const reconstructed = reconstructPath(parent, startId, endId, playerLookup);
    path = reconstructed.path;
    separationNumber = reconstructed.separationNumber;
  }

  const onPathKeys = new Set<string>();
  for (let i = 1; i < path.length; i++) {
    onPathKeys.add(`${path[i].clubId ?? path[i].club}::${path[i].season}`);
  }

  // Per-depth rollup (depth 0 is the source itself).
  const byDepth = new Map<number, { clubCount: number; playerCount: number }>();
  for (const agg of hubAgg.values()) {
    const d = byDepth.get(agg.depth) ?? { clubCount: 0, playerCount: 0 };
    d.clubCount++;
    d.playerCount += agg.reachedCount;
    byDepth.set(agg.depth, d);
  }
  const layers: BfsLayer[] = [
    { depth: 0, clubCount: 0, playerCount: 1 },
    ...[...byDepth.entries()].sort((a, b) => a[0] - b[0]).map(([d, v]) => ({ depth: d, ...v })),
  ];

  // Cap: always keep on-path hubs, then the most-reaching ones up to maxClusters.
  const entries = [...hubAgg.entries()];
  const kept = new Set<string>();
  for (const [k] of entries) if (onPathKeys.has(k)) kept.add(k);
  for (const [k] of entries.filter(([k]) => !kept.has(k)).sort((a, b) => b[1].reachedCount - a[1].reachedCount)) {
    if (kept.size >= maxClusters) break;
    kept.add(k);
  }

  // Dropped hubs fold into one overflow node per depth.
  const overflowByDepth = new Map<number, { reachedCount: number; clubCount: number }>();
  for (const [k, agg] of entries) {
    if (kept.has(k)) continue;
    const o = overflowByDepth.get(agg.depth) ?? { reachedCount: 0, clubCount: 0 };
    o.reachedCount += agg.reachedCount;
    o.clubCount++;
    overflowByDepth.set(agg.depth, o);
  }

  const clusters: HubCluster[] = [];
  for (const [k, agg] of entries) {
    if (!kept.has(k)) continue;
    // If this hub's BFS parent was dropped, re-point the edge to that depth's
    // overflow node so no edge dangles.
    let parentKey = agg.parentKey;
    if (parentKey && !kept.has(parentKey)) {
      parentKey = overflowByDepth.has(agg.depth - 1) ? `overflow::${agg.depth - 1}` : null;
    }
    clusters.push({
      key: k,
      club: agg.club,
      clubId: agg.clubId ?? null,
      season: agg.season,
      depth: agg.depth,
      reachedCount: agg.reachedCount,
      parentKey,
      onPath: onPathKeys.has(k),
    });
  }
  for (const [d, o] of [...overflowByDepth.entries()].sort((a, b) => a[0] - b[0])) {
    clusters.push({
      key: `overflow::${d}`,
      club: `+${o.clubCount} more club${o.clubCount === 1 ? "" : "s"}`,
      clubId: null,
      season: "",
      depth: d,
      reachedCount: o.reachedCount,
      parentKey: overflowByDepth.has(d - 1) ? `overflow::${d - 1}` : null,
      onPath: false,
      clubCount: o.clubCount,
    });
  }

  return {
    found,
    separationNumber,
    path,
    clusters,
    layers,
    totals: { visitedPlayers: visited.size, visitedHubs: hubAgg.size },
  };
}
