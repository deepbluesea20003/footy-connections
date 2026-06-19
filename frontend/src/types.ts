export interface PlayerSuggestion {
  id: string;
  name: string;
  dateOfBirth?: string | null;
  clubs: string[];
}

export interface PathStep {
  player: string;
  playerId: string;
  playerWikidataId?: string | null;
  club: string;
  clubId?: string | null;
  season: string;
}

export interface SeparationResult {
  found: boolean;
  separationNumber: number;
  path: PathStep[];
}

export type RequestStatus = "idle" | "loading" | "success" | "error";

export interface SeparationState {
  status: RequestStatus;
  result: SeparationResult | null;
  error: string | null;
}
