-- Canonical player. `id` is a readable slug we own (source-agnostic), made
-- unique with a birth-year suffix when two slugs would otherwise collide.
-- The real cross-source dedup key is (normalized name + date_of_birth).
CREATE TABLE IF NOT EXISTS players (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  date_of_birth DATE,
  nationality   TEXT
);

CREATE INDEX IF NOT EXISTS idx_players_dob ON players(date_of_birth);

-- Per-source provider IDs (football-data, fbref, transfermarkt, ...).
-- Lets us re-sync each source idempotently and map any provider's ID back to
-- our canonical player without making any one provider privileged.
CREATE TABLE IF NOT EXISTS player_external_ids (
  source      TEXT NOT NULL,
  external_id TEXT NOT NULL,
  player_id   TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  PRIMARY KEY (source, external_id)
);

CREATE INDEX IF NOT EXISTS idx_pei_player ON player_external_ids(player_id);

CREATE TABLE IF NOT EXISTS clubs (
  id   TEXT PRIMARY KEY,
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
