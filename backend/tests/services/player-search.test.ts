import { describe, it, expect } from "vitest";
import { InMemoryPlayerSearchService } from "../../src/services/player-search.js";
import { testPlayers } from "../helpers/fixtures.js";
import type { Player } from "../../src/types/player.js";

const service = new InMemoryPlayerSearchService(testPlayers);

describe("InMemoryPlayerSearchService", () => {
  it("finds exact match", async () => {
    const results = await service.search("Alice Smith");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("alice");
  });

  it("is case insensitive", async () => {
    const results = await service.search("alice smith");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("alice");
  });

  it("strips diacritics", async () => {
    const results = await service.search("Carol Garcia");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("carol");
  });

  it("matches by last name only", async () => {
    const results = await service.search("Smith");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("alice");
  });

  it("matches by first name only", async () => {
    const results = await service.search("Bob");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("bob");
  });

  it("returns empty for no match", async () => {
    const results = await service.search("Nonexistent");
    expect(results).toHaveLength(0);
  });

  it("handles typos via levenshtein", async () => {
    const results = await service.search("Alise");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((p) => p.id === "alice")).toBe(true);
  });

  describe("resolve", () => {
    it("returns found for exact match", async () => {
      const result = await service.resolve("Alice Smith");
      expect(result).toMatchObject({ type: "found", player: { id: "alice" } });
    });

    it("returns null for no match", async () => {
      const result = await service.resolve("Nobody");
      expect(result).toBeNull();
    });
  });

  describe("popularity ranking", () => {
    const peles: Player[] = [
      { id: "pele-1987", name: "Pelé", popularity: 1.5, clubs: [] },
      { id: "pele-1940", name: "Pelé", popularity: 2.5, clubs: [] }, // the legend
      { id: "pele-1991", name: "Pelé", popularity: 1.4, clubs: [] },
    ];
    const popService = new InMemoryPlayerSearchService(peles);

    it("returns every same-name player, not just one", async () => {
      const results = await popService.search("Pelé");
      expect(results).toHaveLength(3);
    });

    it("ranks the most popular same-name player first", async () => {
      const results = await popService.search("Pelé");
      expect(results[0].id).toBe("pele-1940");
    });

    it("resolve() picks the most popular exact match", async () => {
      const result = await popService.resolve("Pelé");
      expect(result).toMatchObject({ type: "found", player: { id: "pele-1940" } });
    });
  });
});
