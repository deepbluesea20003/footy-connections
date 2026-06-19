// A bipartite graph: players are linked to the club-season "nodes" they belong
// to, rather than to each other directly. Two players are teammates iff they
// share a ClubSeasonNode. This avoids materializing O(Σ roster²) pairwise edges
// (~38M for the full dataset) — instead we store one node per club-season and
// traverse through it, which is ~10x smaller in memory and trivial to build.
export interface ClubSeasonNode {
  club: string;
  season: string;
  roster: string[]; // player ids who shared this club-season
}

export interface BipartiteGraph {
  // playerId -> the club-season nodes they belong to (sorted by season desc so
  // path reconstruction surfaces the most recent shared season first).
  playerToSeasons: Map<string, ClubSeasonNode[]>;
}

export interface PathStep {
  player: string;
  playerId: string;
  club: string;
  season: string;
}

export interface SeparationResult {
  found: boolean;
  separationNumber: number;
  path: PathStep[];
}
