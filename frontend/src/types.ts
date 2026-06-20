export interface PlayerSuggestion {
  id: string;
  name: string;
  dateOfBirth?: string | null;
  nationality?: string | null;
  /** Wikimedia Commons thumbnail URL, or null if the player has no photo. */
  imageUrl?: string | null;
  /** Search-ranking score; used to bucket a notability indicator in the UI. */
  popularity?: number | null;
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
