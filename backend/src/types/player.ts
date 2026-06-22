export interface ClubStint {
  club: string;
  /** Transfermarkt club id (used to derive the crest URL). */
  clubId?: string;
  seasons: string[];
}

export interface Player {
  id: string;
  name: string;
  /** ISO date string, YYYY-MM-DD. Optional: not all rows have it. */
  dateOfBirth?: string;
  nationality?: string;
  /** Wikidata QID — legacy; unused with the Transfermarkt source (always undefined). */
  wikidataId?: string;
  /** Full player-photo URL (Transfermarkt portrait). */
  imageUrl?: string;
  /** Search-ranking score = ln(1 + highest market value). Higher = more notable. */
  popularity?: number;
  /** Career: the distinct clubs+seasons the player actually appeared in. */
  clubs: ClubStint[];
}
