-- Canonical player. `id` is a readable slug we own (source-agnostic), made
-- unique with a birth-year suffix when two slugs would otherwise collide.
-- The real cross-source dedup key is (normalized name + date_of_birth).
CREATE TABLE IF NOT EXISTS players (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  date_of_birth DATE,
  nationality   TEXT,
  -- Search-ranking signals, populated offline by enrich:wikidata from each
  -- player's Wikidata QID. `sitelinks` = number of Wikipedia language editions
  -- (a global-fame proxy); `image_file` = Wikimedia Commons filename for a
  -- thumbnail; `popularity` = precomputed blend of sitelinks + career/recency
  -- that search() orders by, so the most notable same-name player ranks first.
  sitelinks     INT,
  image_file    TEXT,
  popularity    REAL
);

CREATE INDEX IF NOT EXISTS idx_players_dob ON players(date_of_birth);
CREATE INDEX IF NOT EXISTS idx_players_popularity ON players(popularity DESC NULLS LAST);

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
  name TEXT NOT NULL,
  -- Crest image URL, populated by enrich:crests (football-data.org for major
  -- clubs, then Wikidata P154). NULL clubs fall back to a generated badge in UI.
  crest_url TEXT
);

CREATE TABLE IF NOT EXISTS player_club_seasons (
  player_id TEXT REFERENCES players(id) ON DELETE CASCADE,
  club_id   TEXT REFERENCES clubs(id) ON DELETE CASCADE,
  season    TEXT NOT NULL,
  PRIMARY KEY (player_id, club_id, season)
);

CREATE INDEX IF NOT EXISTS idx_pcs_player ON player_club_seasons(player_id);
CREATE INDEX IF NOT EXISTS idx_pcs_club_season ON player_club_seasons(club_id, season);

-- Trigram search over player names (powers DbPlayerSearchService). Applied at
-- runtime by ensureSearchIndex() in db/search-schema.ts; kept here as the
-- canonical reference. f_unaccent is an IMMUTABLE, schema-qualified wrapper so
-- it can back the index.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE OR REPLACE FUNCTION f_unaccent(text) RETURNS text AS
  $$ SELECT lower(public.unaccent('public.unaccent'::regdictionary, $1)) $$
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE;
CREATE INDEX IF NOT EXISTS idx_players_name_trgm
  ON players USING gin (f_unaccent(name) gin_trgm_ops);

-- Checkpointing for the resumable Wikidata importer (also self-created by the
-- script via ensureSchema). import_jobs holds the discovery cursor + phase;
-- import_club_queue is the per-club work queue.
CREATE TABLE IF NOT EXISTS import_jobs (
  id               TEXT PRIMARY KEY,
  phase            TEXT NOT NULL DEFAULT 'discovery',
  discovery_cursor TEXT NOT NULL DEFAULT '',
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS import_club_queue (
  club_qid     TEXT PRIMARY KEY,
  club_name    TEXT,
  status       TEXT NOT NULL DEFAULT 'pending',  -- pending | done | error
  member_rows  INT,
  season_rows  INT,
  attempts     INT NOT NULL DEFAULT 0,
  last_error   TEXT,
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_icq_status ON import_club_queue(status);
