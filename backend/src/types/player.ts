export interface ClubStint {
  club: string;
  seasons: string[];
}

export interface Player {
  id: string;
  name: string;
  /** ISO date string, YYYY-MM-DD. Optional: not all sources/seed rows have it. */
  dateOfBirth?: string;
  nationality?: string;
  clubs: ClubStint[];
}
