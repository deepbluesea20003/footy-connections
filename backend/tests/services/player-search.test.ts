import { describe, it, expect } from "vitest";
import { PlayerSearchService } from "../../src/services/player-search.js";
import { testPlayers } from "../helpers/fixtures.js";
import type { Player } from "../../src/types/player.js";

const service = new PlayerSearchService(testPlayers);

describe("PlayerSearchService", () => {
  it("finds exact match", () => {
    const results = service.search("Alice Smith");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("alice");
  });

  it("is case insensitive", () => {
    const results = service.search("alice smith");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("alice");
  });

  it("strips diacritics", () => {
    const results = service.search("Carol Garcia");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("carol");
  });

  it("matches by last name only", () => {
    const results = service.search("Smith");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("alice");
  });

  it("matches by first name only", () => {
    const results = service.search("Bob");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("bob");
  });

  it("returns empty for no match", () => {
    const results = service.search("Nonexistent");
    expect(results).toHaveLength(0);
  });

  it("handles typos via levenshtein", () => {
    const results = service.search("Alise");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((p) => p.id === "alice")).toBe(true);
  });

  describe("resolve", () => {
    it("returns found for exact match", () => {
      const result = service.resolve("Alice Smith");
      expect(result).toMatchObject({ type: "found", player: { id: "alice" } });
    });

    it("returns null for no match", () => {
      const result = service.resolve("Nobody");
      expect(result).toBeNull();
    });
  });

  describe("popularity ranking", () => {
    const peles: Player[] = [
      { id: "pele-1987", name: "Pelé", popularity: 1.5, clubs: [] },
      { id: "pele-1940", name: "Pelé", popularity: 2.5, clubs: [] }, // the legend
      { id: "pele-1991", name: "Pelé", popularity: 1.4, clubs: [] },
    ];
    const popService = new PlayerSearchService(peles);

    it("returns every same-name player, not just one", () => {
      const results = popService.search("Pelé");
      expect(results).toHaveLength(3);
    });

    it("ranks the most popular same-name player first", () => {
      const results = popService.search("Pelé");
      expect(results[0].id).toBe("pele-1940");
    });

    it("resolve() picks the most popular exact match", () => {
      const result = popService.resolve("Pelé");
      expect(result).toMatchObject({ type: "found", player: { id: "pele-1940" } });
    });
  });
});
