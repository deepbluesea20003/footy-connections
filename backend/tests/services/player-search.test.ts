import { describe, it, expect } from "vitest";
import { PlayerSearchService } from "../../src/services/player-search.js";
import { testPlayers } from "../helpers/fixtures.js";

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
});
