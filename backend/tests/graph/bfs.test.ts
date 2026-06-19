import { describe, it, expect } from "vitest";
import { buildGraph } from "../../src/graph/build.js";
import { findShortestPath } from "../../src/graph/bfs.js";
import { testPlayers } from "../helpers/fixtures.js";
import type { Player } from "../../src/types/player.js";

const graph = buildGraph(testPlayers);
const lookup = new Map<string, Player>(testPlayers.map((p) => [p.id, p]));

describe("findShortestPath", () => {
  it("returns separation 0 for same player", () => {
    const result = findShortestPath(graph, "alice", "alice", lookup);
    expect(result).toMatchObject({
      found: true,
      separationNumber: 0,
      path: [{ player: "Alice Smith", playerId: "alice" }],
    });
  });

  it("finds direct teammates (separation 1)", () => {
    const result = findShortestPath(graph, "alice", "bob", lookup);
    expect(result).toMatchObject({
      found: true,
      separationNumber: 1,
    });
    expect(result!.path).toHaveLength(2);
    expect(result!.path[0].player).toBe("Alice Smith");
    expect(result!.path[1].player).toBe("Bob Jones");
    expect(result!.path[1].club).toBe("Club A");
  });

  it("finds multi-hop paths (separation 2)", () => {
    const result = findShortestPath(graph, "alice", "carol", lookup);
    expect(result).toMatchObject({
      found: true,
      separationNumber: 2,
    });
    expect(result!.path).toHaveLength(3);
  });

  it("returns not found for unreachable players", () => {
    const result = findShortestPath(graph, "alice", "frank", lookup);
    expect(result).toMatchObject({
      found: false,
      separationNumber: -1,
      path: [],
    });
  });

  it("returns null for unknown player ids", () => {
    const result = findShortestPath(graph, "alice", "unknown", lookup);
    expect(result).toBeNull();
  });

  it("includes club and season in path steps", () => {
    const result = findShortestPath(graph, "bob", "carol", lookup);
    expect(result!.path[1].club).toBe("Club B");
    expect(result!.path[1].season).toBe("2024-25");
  });

  it("propagates Wikidata player + club ids into path steps", () => {
    const players: Player[] = [
      { id: "a", name: "A", wikidataId: "Q1", clubs: [{ club: "FC X", clubId: "Q100", seasons: ["2020-21"] }] },
      { id: "b", name: "B", wikidataId: "Q2", clubs: [{ club: "FC X", clubId: "Q100", seasons: ["2020-21"] }] },
    ];
    const g = buildGraph(players);
    const result = findShortestPath(g, "a", "b", new Map(players.map((p) => [p.id, p])));
    expect(result!.path[0].playerWikidataId).toBe("Q1");
    expect(result!.path[1].playerWikidataId).toBe("Q2");
    expect(result!.path[1].clubId).toBe("Q100"); // connecting club id
    expect(result!.path[0].clubId).toBeNull(); // start node has no incoming club
  });
});
