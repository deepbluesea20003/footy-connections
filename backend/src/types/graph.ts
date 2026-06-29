// A bipartite graph: players are linked to the club-season "nodes" they belong
// to, rather than to each other directly. Two players are teammates iff they
// share a ClubSeasonNode. This avoids materializing O(Σ roster²) pairwise edges
// (~38M for the full dataset) — instead we store one node per club-season and
// traverse through it, which is ~10x smaller in memory and trivial to build.
// A teammate "hub": one club's matchday squad in one game. Two players sharing
// a node co-appeared (were named in the same squad), so every edge is a real,
// verifiable teammate relationship. (For the hardcoded/test fallback there are
// no real games, so `gameId` is synthesized per club-season.)
export interface ClubSeasonNode {
  /** Transfermarkt game id (or a synthetic club-season key in the fallback). */
  gameId: string;
  club: string;
  /** Transfermarkt club id, for crest URLs. */
  clubId?: string;
  season: string;
  /** Match date (YYYY-MM-DD), when known. */
  date?: string;
  /** Competition code the game belongs to (e.g. "GB1", "af:2"), when known. */
  competition?: string;
  roster: string[]; // player ids named in this club's squad for this game
}

/** One player's appearance in a club's matchday squad — the graph's edge basis. */
export interface Appearance {
  playerId: string;
  gameId: string;
  clubId: string;
  club: string;
  season: string;
  date?: string;
}

export interface BipartiteGraph {
  // playerId -> the club-season nodes they belong to (sorted by season desc so
  // path reconstruction surfaces the most recent shared season first).
  playerToSeasons: Map<string, ClubSeasonNode[]>;
  // `${clubId|club}::${season}` -> the shared node, for squad lookups (the full
  // roster of a club-season) without re-querying the DB.
  clubSeasonIndex: Map<string, ClubSeasonNode>;
}

export interface PathStep {
  player: string;
  playerId: string;
  /** The game whose squad links this player to the previous one (for the squad view). */
  gameId?: string | null;
  /** The connecting player's Wikidata QID, if known (links to their entity). */
  playerWikidataId?: string | null;
  /** The connecting player's photo thumbnail URL, if known. */
  playerImageUrl?: string | null;
  club: string;
  /** The connecting club's id (Wikidata QID or slug), if known. */
  clubId?: string | null;
  /** The connecting club's crest URL, if known (else the UI shows a badge). */
  clubCrestUrl?: string | null;
  season: string;
}

export interface SeparationResult {
  found: boolean;
  separationNumber: number;
  path: PathStep[];
}

// --- BFS exploration visualization ---------------------------------------
// `bfsExplore` returns the shortest path PLUS an aggregated view of everything
// the search touched, clustered by club-season hub so the (potentially 100k+)
// visited players collapse into a bounded, renderable set.

/** One club-season the BFS traversed, summarizing the players first reached
 *  through it. `parentKey` is the hub that led here (the aggregated BFS tree). */
export interface HubCluster {
  key: string;               // `${clubId|club}::${season}`, or `overflow::<depth>`
  club: string;
  clubId?: string | null;
  season: string;
  /** BFS depth (degree from the source) of the players reached via this hub. */
  depth: number;
  /** Number of players first reached through this hub. */
  reachedCount: number;
  /** The hub that brought BFS here; null at the source. Edges = parentKey → key. */
  parentKey: string | null;
  /** True if this hub lies on the shortest path. */
  onPath: boolean;
  /** Crest URL, attached by the route from clubsById. */
  crestUrl?: string | null;
  /** For overflow nodes: how many distinct clubs were folded in. */
  clubCount?: number;
}

/** Per-depth rollup for the "BFS visited N players across M layers" summary. */
export interface BfsLayer {
  depth: number;
  clubCount: number;
  playerCount: number;
}

export interface ExploreResult {
  found: boolean;
  separationNumber: number;
  path: PathStep[];
  clusters: HubCluster[];
  layers: BfsLayer[];
  totals: { visitedPlayers: number; visitedHubs: number };
}
