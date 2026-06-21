import { describe, it, expect } from "vitest";
import { buildGraph } from "../../src/graph/build.js";
import { findShortestPath, bfsExplore } from "../../src/graph/bfs.js";
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

describe("bfsExplore", () => {
  it("returns the path plus aggregated clusters/layers/totals", () => {
    const result = bfsExplore(graph, "alice", "carol", lookup);

    expect(result.found).toBe(true);
    expect(result.separationNumber).toBe(2);
    expect(result.path).toHaveLength(3);

    // Two hubs contributed: Club A 2023-24 (reaches bob) and Club B 2024-25 (carol).
    expect(result.totals).toEqual({ visitedPlayers: 3, visitedHubs: 2 });
    expect(result.clusters).toHaveLength(2);
    expect(result.clusters.every((c) => c.onPath)).toBe(true);

    const byKey = new Map(result.clusters.map((c) => [c.key, c]));
    expect(byKey.has("Club A::2023-24")).toBe(true);
    // The depth-2 hub's edge points back to the depth-1 hub (aggregated BFS tree).
    expect(byKey.get("Club B::2024-25")).toMatchObject({ depth: 2, parentKey: "Club A::2023-24" });

    // Layers: source (depth 0) + one player at each of depths 1 and 2.
    expect(result.layers).toEqual([
      { depth: 0, clubCount: 0, playerCount: 1 },
      { depth: 1, clubCount: 1, playerCount: 1 },
      { depth: 2, clubCount: 1, playerCount: 1 },
    ]);
  });

  it("still aggregates the explored component when no path exists", () => {
    const result = bfsExplore(graph, "alice", "frank", lookup);
    expect(result.found).toBe(false);
    expect(result.path).toEqual([]);
    expect(result.totals.visitedPlayers).toBe(3); // alice's whole component
    expect(result.clusters.some((c) => c.onPath)).toBe(false);
  });

  it("caps clusters and folds the rest into a per-depth overflow node", () => {
    // Source reaches 4 teammates through 4 distinct club-seasons; target Z is
    // isolated, so BFS explores the whole component (all 4 hubs contribute).
    const players: Player[] = [
      { id: "s", name: "S", clubs: ["C1", "C2", "C3", "C4"].map((club) => ({ club, seasons: ["2020-21"] })) },
      { id: "t1", name: "T1", clubs: [{ club: "C1", seasons: ["2020-21"] }] },
      { id: "t2", name: "T2", clubs: [{ club: "C2", seasons: ["2020-21"] }] },
      { id: "t3", name: "T3", clubs: [{ club: "C3", seasons: ["2020-21"] }] },
      { id: "t4", name: "T4", clubs: [{ club: "C4", seasons: ["2020-21"] }] },
      { id: "z", name: "Z", clubs: [{ club: "Z1", seasons: ["2020-21"] }] },
    ];
    const g = buildGraph(players);
    const result = bfsExplore(g, "s", "z", new Map(players.map((p) => [p.id, p])), { maxClusters: 2 });

    expect(result.found).toBe(false);
    expect(result.totals.visitedHubs).toBe(4);
    // 2 kept hubs + 1 overflow node folding the other 2 clubs.
    expect(result.clusters).toHaveLength(3);
    const overflow = result.clusters.find((c) => c.key === "overflow::1");
    expect(overflow).toMatchObject({ clubCount: 2, reachedCount: 2, onPath: false });
    // No players are lost in aggregation.
    expect(result.clusters.reduce((sum, c) => sum + c.reachedCount, 0)).toBe(4);
  });
});
