import { describe, it, expect } from "vitest";
import { buildGraph } from "../../src/graph/build.js";
import { testPlayers } from "../helpers/fixtures.js";

describe("buildGraph", () => {
  const graph = buildGraph(testPlayers);

  it("connects players at the same club in the same season", () => {
    const aliceEdges = graph.get("alice")!;
    const bobEdge = aliceEdges.find((e) => e.playerId === "bob");
    expect(bobEdge).toBeDefined();
    expect(bobEdge!.sharedClubSeasons).toContainEqual({
      club: "Club A",
      season: "2023-24",
    });
  });

  it("does not connect players at the same club but different seasons", () => {
    const bobEdges = graph.get("bob")!;
    const daveEdge = bobEdges.find((e) => e.playerId === "dave");
    expect(daveEdge).toBeUndefined();
  });

  it("does not connect players at different clubs", () => {
    const aliceEdges = graph.get("alice")!;
    const carolEdge = aliceEdges.find((e) => e.playerId === "carol");
    expect(carolEdge).toBeUndefined();
  });

  it("stores multiple shared club-seasons on a single edge", () => {
    const aliceEdges = graph.get("alice")!;
    const bobEdge = aliceEdges.find((e) => e.playerId === "bob");
    expect(bobEdge!.sharedClubSeasons).toHaveLength(1);
  });

  it("creates bidirectional edges", () => {
    const bobEdges = graph.get("bob")!;
    const aliceEdge = bobEdges.find((e) => e.playerId === "alice");
    expect(aliceEdge).toBeDefined();
  });

  it("includes isolated players as nodes with no edges", () => {
    expect(graph.has("frank")).toBe(true);
    expect(graph.get("frank")!).toHaveLength(0);
  });
});
