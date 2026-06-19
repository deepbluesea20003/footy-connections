// A bipartite graph: players are linked to the club-season "nodes" they belong
// to, rather than to each other directly. Two players are teammates iff they
// share a ClubSeasonNode. This avoids materializing O(Σ roster²) pairwise edges
// (~38M for the full dataset) — instead we store one node per club-season and
// traverse through it, which is ~10x smaller in memory and trivial to build.
export interface ClubSeasonNode {
  club: string;
  /** Source club id (Wikidata QID or seed slug), for building UI links. */
  clubId?: string;
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
  /** The connecting player's Wikidata QID, if known (links to their entity). */
  playerWikidataId?: string | null;
  club: string;
  /** The connecting club's id (Wikidata QID or slug), if known. */
  clubId?: string | null;
  season: string;
}

export interface SeparationResult {
  found: boolean;
  separationNumber: number;
  path: PathStep[];
}
