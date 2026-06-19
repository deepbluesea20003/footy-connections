import { describe, it, expect } from "vitest";
import { buildGraph } from "../../src/graph/build.js";
import { testPlayers } from "../helpers/fixtures.js";

describe("buildGraph", () => {
  const graph = buildGraph(testPlayers);

  it("groups players who share a club-season into the same roster", () => {
    const aliceNodes = graph.playerToSeasons.get("alice")!;
    const clubA2324 = aliceNodes.find(
      (n) => n.club === "Club A" && n.season === "2023-24"
    )!;
    expect(clubA2324.roster).toContain("bob");
  });

  it("does not group players from the same club but different seasons", () => {
    // bob is Club B 2024-25; dave is Club B 2023-24 — different nodes.
    const bobNodes = graph.playerToSeasons.get("bob")!;
    const bobClubB = bobNodes.find((n) => n.club === "Club B")!;
    expect(bobClubB.season).toBe("2024-25");
    expect(bobClubB.roster).not.toContain("dave");
  });

  it("does not link players at different clubs", () => {
    const aliceNodes = graph.playerToSeasons.get("alice")!;
    const reachable = new Set(aliceNodes.flatMap((n) => n.roster));
    expect(reachable.has("carol")).toBe(false);
  });

  it("shares one node object across everyone in a club-season", () => {
    const aliceNodes = graph.playerToSeasons.get("alice")!;
    const bobNodes = graph.playerToSeasons.get("bob")!;
    const aliceA = aliceNodes.find(
      (n) => n.club === "Club A" && n.season === "2023-24"
    );
    const bobA = bobNodes.find(
      (n) => n.club === "Club A" && n.season === "2023-24"
    );
    expect(aliceA).toBe(bobA);
  });

  it("registers isolated players as nodes with no teammates", () => {
    expect(graph.playerToSeasons.has("frank")).toBe(true);
    const frankNodes = graph.playerToSeasons.get("frank")!;
    const teammates = frankNodes
      .flatMap((n) => n.roster)
      .filter((id) => id !== "frank");
    expect(teammates).toHaveLength(0);
  });
});
