import type { Player } from "../types/player.js";
import { normalize, levenshtein } from "../utils/string.js";

export type ResolveResult =
  | { type: "found"; player: Player }
  | { type: "ambiguous"; players: Player[] };

export interface PlayerSearchService {
  search(query: string, limit?: number): Promise<Player[]>;
  resolve(query: string): Promise<ResolveResult | null>;
}

/** Most-notable-first. Players without a popularity score sort last; the
 *  stable sort keeps the original (DB) order for ties. */
function byPopularity(a: Player, b: Player): number {
  return (b.popularity ?? 0) - (a.popularity ?? 0);
}

/**
 * In-memory ranked search over a fixed player list. Used for the hardcoded-data
 * fallback (no DATABASE_URL) and in tests. The production, full-dataset path is
 * DbPlayerSearchService, which pushes ranking (including popularity) into Postgres.
 */
export class InMemoryPlayerSearchService implements PlayerSearchService {
  /** normalized full name -> all players with that name, most-notable first.
   *  A Map<string, Player[]> (not Player) so colliding names — e.g. the several
   *  "Pelé"s — are all retained and the famous one can win, instead of whoever
   *  was indexed last silently overwriting the rest. */
  private normalizedIndex = new Map<string, Player[]>();
  private tokenIndex = new Map<string, Player[]>();
  /** All players, pre-sorted by popularity so every match tier comes out
   *  most-notable-first without re-sorting per query. */
  private players: Player[];

  constructor(players: Player[]) {
    this.players = [...players].sort(byPopularity);

    for (const player of this.players) {
      const norm = normalize(player.name);
      let exact = this.normalizedIndex.get(norm);
      if (!exact) {
        exact = [];
        this.normalizedIndex.set(norm, exact);
      }
      exact.push(player);

      for (const token of norm.split(" ")) {
        let list = this.tokenIndex.get(token);
        if (!list) {
          list = [];
          this.tokenIndex.set(token, list);
        }
        list.push(player);
      }
    }
  }

  async search(query: string, limit = 10): Promise<Player[]> {
    const norm = normalize(query);
    if (!norm) return [];

    // Tier 1: exact name. Return *every* player with this name, fame-first,
    // so "pele" surfaces the legend ahead of his lesser namesakes.
    const exact = this.normalizedIndex.get(norm);
    if (exact && exact.length > 0) return exact.slice(0, limit);

    // Tier 2: full-name prefix ("kev" -> "Kevin De Bruyne"). `players` is
    // pre-sorted, so filtering preserves most-notable-first order.
    const prefixMatches = this.players.filter((p) =>
      normalize(p.name).startsWith(norm)
    );
    if (prefixMatches.length > 0) return prefixMatches.slice(0, limit);

    // Tier 3: any name token prefix-matches any query token.
    const queryTokens = norm.split(" ");
    const tokenMatches = new Set<Player>();
    for (const qt of queryTokens) {
      for (const [token, players] of this.tokenIndex) {
        if (token.startsWith(qt)) {
          for (const p of players) tokenMatches.add(p);
        }
      }
    }
    if (tokenMatches.size > 0) {
      return [...tokenMatches].sort(byPopularity).slice(0, limit);
    }

    // Tier 4: fuzzy fallback for typos. Order by edit distance, then fame.
    const scored: { player: Player; distance: number }[] = [];
    for (const player of this.players) {
      const nameTokens = normalize(player.name).split(" ");
      let minDist = Infinity;
      for (const qt of queryTokens) {
        for (const nt of nameTokens) {
          minDist = Math.min(minDist, levenshtein(qt, nt));
        }
      }
      if (minDist <= 2) {
        scored.push({ player, distance: minDist });
      }
    }
    scored.sort((a, b) => a.distance - b.distance || byPopularity(a.player, b.player));
    return scored.slice(0, limit).map((s) => s.player);
  }

  async resolve(query: string): Promise<ResolveResult | null> {
    const results = await this.search(query);
    if (results.length === 0) return null;
    if (results.length === 1) return { type: "found", player: results[0] };

    // Multiple matches: if any is an exact-name hit, take the most notable one
    // (results are already fame-ordered) rather than forcing disambiguation.
    const norm = normalize(query);
    const exactMatch = results.find((p) => normalize(p.name) === norm);
    if (exactMatch) return { type: "found", player: exactMatch };

    return { type: "ambiguous", players: results };
  }
}
