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
  playerImageUrl?: string | null;
  club: string;
  clubId?: string | null;
  clubCrestUrl?: string | null;
  season: string;
}

export interface CareerStint {
  club: string;
  clubId: string | null;
  crestUrl: string | null;
  seasons: string[];
  firstSeason: string;
  lastSeason: string;
}

export interface PlayerDetail {
  id: string;
  name: string;
  dateOfBirth?: string | null;
  nationality?: string | null;
  imageUrl?: string | null;
  popularity?: number | null;
  wikipediaUrl?: string | null;
  wikidataUrl?: string | null;
  career: CareerStint[];
}

export interface SquadPlayer {
  id: string;
  name: string;
  dateOfBirth?: string | null;
  nationality?: string | null;
  imageUrl?: string | null;
  popularity?: number | null;
  wikipediaUrl?: string | null;
  wikidataUrl?: string | null;
}

export interface SquadResponse {
  club: { id: string; name: string; crestUrl: string | null; wikidataUrl: string | null };
  season: string;
  players: SquadPlayer[];
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
