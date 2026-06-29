import { describe, it, expect } from "vitest";
import { buildGraph } from "../../src/graph/build.js";
import { createGameService } from "../../src/services/game.js";
import type { Player } from "../../src/types/player.js";
import type { ClubInfo } from "../../src/db/loader.js";

// A linear chain: Albert–Bruno–Carlos–Diego–Emilio–Fabio, each consecutive pair
// sharing one club. All famous (popularity 18 clears every endpoint floor) so
// they're eligible puzzle endpoints. Distances from Albert: Bruno 1, Carlos 2,
// Diego 3, Emilio 4, Fabio 5.
const S = ["2023-24"];
const chain: Player[] = [
  { id: "albert", name: "Albert One", popularity: 18, nationality: "Spain", clubs: [{ club: "C12", seasons: S }] },
  { id: "bruno", name: "Bruno Two", popularity: 18, nationality: "Italy", clubs: [{ club: "C12", seasons: S }, { club: "C23", seasons: S }] },
  { id: "carlos", name: "Carlos Three", popularity: 18, nationality: "Brazil", clubs: [{ club: "C23", seasons: S }, { club: "C34", seasons: S }] },
  { id: "diego", name: "Diego Four", popularity: 18, nationality: "Argentina", clubs: [{ club: "C34", seasons: S }, { club: "C45", seasons: S }] },
  { id: "emilio", name: "Emilio Five", popularity: 18, nationality: "Portugal", clubs: [{ club: "C45", seasons: S }, { club: "C56", seasons: S }] },
  { id: "fabio", name: "Fabio Six", popularity: 18, nationality: "France", clubs: [{ club: "C56", seasons: S }] },
];

const graph = buildGraph(chain);
const lookup = new Map<string, Player>(chain.map((p) => [p.id, p]));
const clubs = new Map<string, ClubInfo>();
const game = createGameService({ graph, playerLookup: lookup, clubsById: clubs });

const ids = new Set(chain.map((p) => p.id));

describe("generatePuzzle", () => {
  it("easy puzzles are short (par 2–3) with two distinct famous endpoints", () => {
    const puzzle = game.generatePuzzle({ difficulty: "easy" });
    expect(puzzle).not.toBeNull();
    expect(puzzle!.par).toBeGreaterThanOrEqual(2);
    expect(puzzle!.par).toBeLessThanOrEqual(3);
    expect(puzzle!.player1.id).not.toBe(puzzle!.player2.id);
    expect(ids.has(puzzle!.player1.id) && ids.has(puzzle!.player2.id)).toBe(true);
  });

  it("hard reaches deeper than easy across this chain", () => {
    // Sample a few seeds; the deepest hard par should exceed the deepest easy par.
    const par = (difficulty: "easy" | "hard", seed: string) =>
      game.generatePuzzle({ difficulty, seed })!.par;
    const easyMax = Math.max(...["a", "b", "c", "d"].map((s) => par("easy", s)));
    const hardMax = Math.max(...["a", "b", "c", "d"].map((s) => par("hard", s)));
    expect(hardMax).toBeGreaterThan(easyMax);
  });

  it("is deterministic for a fixed seed", () => {
    const a = game.generatePuzzle({ difficulty: "medium", seed: "daily:2026-06-27" });
    const b = game.generatePuzzle({ difficulty: "medium", seed: "daily:2026-06-27" });
    expect(a).toEqual(b);
  });
});

describe("linkBetween", () => {
  it("confirms real teammates and returns the shared club-season", () => {
    const res = game.linkBetween("albert", "bruno");
    expect(res.connected).toBe(true);
    expect(res.links[0]).toMatchObject({ club: "C12", season: "2023-24" });
    expect(res.links[0].gamesTogether).toBeGreaterThanOrEqual(1);
  });

  it("rejects non-teammates", () => {
    expect(game.linkBetween("albert", "carlos").connected).toBe(false);
    expect(game.linkBetween("albert", "fabio").connected).toBe(false);
  });

  it("is not connected to self", () => {
    expect(game.linkBetween("albert", "albert").connected).toBe(false);
  });
});

describe("hintFor", () => {
  it("points to the next club + obfuscated player on the way to the target", () => {
    const hint = game.hintFor("albert", "carlos");
    expect(hint.found).toBe(true);
    expect(hint.club).toBe("C12"); // Albert→Bruno link
    expect(hint.isFinal).toBe(false);
    expect(hint.player).toMatchObject({ initial: "B", nationality: "Italy" });
  });

  it("marks the final link when the next player is the target", () => {
    const hint = game.hintFor("albert", "bruno");
    expect(hint.found).toBe(true);
    expect(hint.isFinal).toBe(true);
    expect(hint.player).toBeNull();
  });
});
