export interface ClubStint {
  club: string;
  /** Source club id — a Wikidata QID (e.g. "Q50602") for imported clubs, or a
   *  slug for seed clubs. Used to build Wikidata links in the UI. */
  clubId?: string;
  seasons: string[];
}

export interface Player {
  id: string;
  name: string;
  /** ISO date string, YYYY-MM-DD. Optional: not all sources/seed rows have it. */
  dateOfBirth?: string;
  nationality?: string;
  /** The player's Wikidata QID, if known (from player_external_ids). */
  wikidataId?: string;
  clubs: ClubStint[];
}
