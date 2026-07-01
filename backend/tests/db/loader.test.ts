import { describe, it, expect } from "vitest";
import { ingestLineupRow, type LineupRow } from "../../src/db/lineup-ingest.js";
import type { Player } from "../../src/types/player.js";
import type { ClubSeasonNode } from "../../src/types/graph.js";

function makePlayerMap(ids: string[]): Map<string, Player> {
  return new Map(ids.map((id) => [id, { id, name: id, clubs: [] } as Player]));
}

const row = (over: Partial<LineupRow> = {}): LineupRow => ({
  player_id: "alice",
  game_id: "g1",
  club_id: "c1",
  club: "Club A",
  season: "2024",
  date: "2024-08-01",
  competition_id: "GB1",
  ...over,
});

describe("ingestLineupRow", () => {
  it("rosters a known player and builds their node + career stint", () => {
    const players = makePlayerMap(["alice"]);
    const nodeByKey = new Map<string, ClubSeasonNode>();
    const playerToSeasons = new Map<string, ClubSeasonNode[]>();

    expect(ingestLineupRow(row(), players, nodeByKey, playerToSeasons)).toBe(true);

    const node = nodeByKey.get("g1::c1");
    expect(node?.roster).toEqual(["alice"]);
    expect(node?.season).toBe("2024-25");
    expect(playerToSeasons.get("alice")).toEqual([node]);
    expect(players.get("alice")!.clubs).toEqual([{ club: "Club A", clubId: "c1", seasons: ["2024-25"] }]);
  });

  it("skips a dangling lineup (player_id absent from players) and mutates nothing", () => {
    const players = makePlayerMap(["alice"]);
    const nodeByKey = new Map<string, ClubSeasonNode>();
    const playerToSeasons = new Map<string, ClubSeasonNode[]>();

    expect(ingestLineupRow(row({ player_id: "tr:ghost" }), players, nodeByKey, playerToSeasons)).toBe(false);

    // No phantom hub, no phantom roster member, no phantom playerToSeasons entry.
    expect(nodeByKey.size).toBe(0);
    expect(playerToSeasons.has("tr:ghost")).toBe(false);
  });

  it("never rosters an unknown id even when a real teammate shares the hub", () => {
    const players = makePlayerMap(["alice", "bob"]);
    const nodeByKey = new Map<string, ClubSeasonNode>();
    const playerToSeasons = new Map<string, ClubSeasonNode[]>();

    ingestLineupRow(row({ player_id: "alice" }), players, nodeByKey, playerToSeasons);
    ingestLineupRow(row({ player_id: "tr:ghost" }), players, nodeByKey, playerToSeasons);
    ingestLineupRow(row({ player_id: "bob" }), players, nodeByKey, playerToSeasons);

    expect(nodeByKey.get("g1::c1")!.roster).toEqual(["alice", "bob"]);
  });
});
