import { sql } from "./connection.js";

/**
 * Idempotently provisions the trigram search objects the DB-backed
 * PlayerSearchService relies on. Safe to run on every boot: each statement is
 * IF NOT EXISTS / OR REPLACE, so after the first run it is a no-op.
 *
 *  - pg_trgm  → trigram similarity + GIN-indexable fuzzy/regex matching
 *  - unaccent → fold diacritics so "García" matches "garcia"
 *  - f_unaccent → IMMUTABLE wrapper (single-arg unaccent is only STABLE, so it
 *    can't back an index). Schema-qualified so it resolves under the restricted
 *    search_path used while building the index.
 *  - idx_players_name_trgm → GIN index over the normalized name powering both
 *    `~` word-prefix regex and the `<%` word-similarity operator.
 */
export async function ensureSearchIndex(): Promise<void> {
  await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`;
  await sql`CREATE EXTENSION IF NOT EXISTS unaccent`;
  await sql`
    CREATE OR REPLACE FUNCTION f_unaccent(text) RETURNS text AS
    $$ SELECT lower(public.unaccent('public.unaccent'::regdictionary, $1)) $$
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_players_name_trgm
    ON players USING gin (f_unaccent(name) gin_trgm_ops)
  `;
}
