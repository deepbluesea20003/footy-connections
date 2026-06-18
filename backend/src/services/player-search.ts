import type { Player } from "../types/player.js";
import { normalize, levenshtein } from "../utils/string.js";

export class PlayerSearchService {
  private normalizedIndex = new Map<string, Player>();
  private tokenIndex = new Map<string, Player[]>();

  constructor(private players: Player[]) {
    for (const player of players) {
      const norm = normalize(player.name);
      this.normalizedIndex.set(norm, player);

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

  search(query: string, limit = 10): Player[] {
    const norm = normalize(query);
    if (!norm) return [];

    const exact = this.normalizedIndex.get(norm);
    if (exact) return [exact];

    const prefixMatches = this.players.filter((p) =>
      normalize(p.name).startsWith(norm)
    );
    if (prefixMatches.length > 0) return prefixMatches.slice(0, limit);

    const queryTokens = norm.split(" ");
    const tokenMatches = new Set<Player>();
    for (const qt of queryTokens) {
      for (const [token, players] of this.tokenIndex) {
        if (token.startsWith(qt)) {
          for (const p of players) tokenMatches.add(p);
        }
      }
    }
    if (tokenMatches.size > 0) return [...tokenMatches].slice(0, limit);

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
    scored.sort((a, b) => a.distance - b.distance);
    return scored.slice(0, limit).map((s) => s.player);
  }

  resolve(query: string): { type: "found"; player: Player } | { type: "ambiguous"; players: Player[] } | null {
    const results = this.search(query);
    if (results.length === 0) return null;
    if (results.length === 1) return { type: "found", player: results[0] };

    const norm = normalize(query);
    const exactMatch = results.find((p) => normalize(p.name) === norm);
    if (exactMatch) return { type: "found", player: exactMatch };

    return { type: "ambiguous", players: results };
  }
}
