export interface ClubSeasonRef {
  club: string;
  season: string;
}

export interface TeammateEdge {
  playerId: string;
  sharedClubSeasons: ClubSeasonRef[];
}

export type AdjacencyList = Map<string, TeammateEdge[]>;

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
