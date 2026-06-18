export interface ClubStint {
  club: string;
  seasons: string[];
}

export interface Player {
  id: string;
  name: string;
  nationality?: string;
  clubs: ClubStint[];
}
