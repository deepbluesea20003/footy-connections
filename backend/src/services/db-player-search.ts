import { sql } from "../db/connection.js";
import type { Player } from "../types/player.js";
import { normalize } from "../utils/string.js";
import type { PlayerSearchService, ResolveResult } from "./player-search.js";

/** Escape regex metacharacters so a name token is matched literally. */
function escapeRegex(s: string): string {
  return s.replace(/[.^$*+?()[\]{}|\\-]/g, "\\$&");
}

interface SearchRow {
  id: string;
  name: string;
  date_of_birth: string | null;
  nationality: string | null;
  image_url: string | null;
  popularity: number | null;
  clubs: string[] | null;
}

/**
 * Postgres-backed ranked search over the full (~220k player) dataset.
 *
 * A candidate must match *every* query token (so "seb ring" no longer drowns
 * under the 500+ players merely starting with "seb"). A token matches a name
 * when it is a word-prefix (`~ '(^|sep)token'`, GIN-indexable) OR is
 * word-similar to some word in the name (`<%`, typo tolerance). Both predicates
 * ride the same trigram index — see ensureSearchIndex().
 *
 * Results are then ranked by relevance tier (exact > full-prefix > all tokens
 * are word-prefixes > fuzzy-only), then word similarity, then `popularity` (the
 * precomputed sitelinks/career notability score) so well-known players win ties
 * — never the tier itself, so a precise match always beats a more famous loose
 * one. popularity/image_file/nationality are returned so the UI can show the
 * notability meter, avatar, and nationality.
 */
export class DbPlayerSearchService implements PlayerSearchService {
  async search(query: string, limit = 10): Promise<Player[]> {
    const qn = normalize(query);
    if (!qn) return [];
    const tokens = qn.split(" ").filter(Boolean);
    if (tokens.length === 0) return [];

    const params: unknown[] = [];
    const reParamIdx: number[] = [];
    const whereClauses = tokens.map((t) => {
      params.push("(^|[^a-z0-9])" + escapeRegex(t));
      const reIdx = params.length;
      reParamIdx.push(reIdx);
      params.push(t);
      const tokIdx = params.length;
      return `(f_unaccent(p.name) ~ $${reIdx} OR $${tokIdx} <% f_unaccent(p.name))`;
    });

    params.push(qn);
    const qnIdx = params.length;
    params.push(limit);
    const limIdx = params.length;

    // tier 2: every token is a word-prefix of the name (cheap to recheck on the
    // small candidate set — reuses the regex params already bound above).
    const allTokensPrefix = reParamIdx.map((i) => `(c.nn ~ $${i})`).join(" AND ");

    const text = `
      WITH cand AS (
        SELECT p.id, p.name, p.date_of_birth, p.nationality, p.image_url,
               p.popularity, f_unaccent(p.name) AS nn
        FROM players p
        WHERE ${whereClauses.join(" AND ")}
      )
      SELECT
        c.id,
        c.name,
        to_char(c.date_of_birth, 'YYYY-MM-DD') AS date_of_birth,
        c.nationality,
        c.image_url,
        c.popularity,
        (SELECT array_agg(DISTINCT cl.name)
           FROM game_lineups gl
           JOIN clubs cl ON cl.id = gl.club_id
          WHERE gl.player_id = c.id) AS clubs
      FROM cand c
      ORDER BY
        (CASE
           WHEN c.nn = $${qnIdx} THEN 4
           WHEN c.nn LIKE $${qnIdx} || '%' THEN 3
           WHEN ${allTokensPrefix} THEN 2
           ELSE 1
         END) DESC,
        word_similarity($${qnIdx}, c.nn) DESC,
        c.popularity DESC NULLS LAST,
        length(c.name) ASC,
        c.name ASC
      LIMIT $${limIdx}`;

    const rows = (await sql.query(text, params)) as SearchRow[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      dateOfBirth: r.date_of_birth ?? undefined,
      nationality: r.nationality ?? undefined,
      imageUrl: r.image_url ?? undefined,
      popularity: r.popularity ?? undefined,
      clubs: (r.clubs ?? []).map((club) => ({ club, seasons: [] })),
    }));
  }

  async resolve(query: string): Promise<ResolveResult | null> {
    const results = await this.search(query, 10);
    if (results.length === 0) return null;
    if (results.length === 1) return { type: "found", player: results[0] };

    const qn = normalize(query);
    const exactMatch = results.find((p) => normalize(p.name) === qn);
    if (exactMatch) return { type: "found", player: exactMatch };

    return { type: "ambiguous", players: results };
  }
}
