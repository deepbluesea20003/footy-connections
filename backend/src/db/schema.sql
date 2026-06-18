CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  nationality TEXT,
  fbref_id TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS clubs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS player_club_seasons (
  player_id TEXT REFERENCES players(id) ON DELETE CASCADE,
  club_id   TEXT REFERENCES clubs(id) ON DELETE CASCADE,
  season    TEXT NOT NULL,
  PRIMARY KEY (player_id, club_id, season)
);

CREATE INDEX IF NOT EXISTS idx_pcs_player ON player_club_seasons(player_id);
CREATE INDEX IF NOT EXISTS idx_pcs_club_season ON player_club_seasons(club_id, season);
