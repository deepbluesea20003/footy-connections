import { describe, it, expect } from "vitest";
import { markLoanStints } from "../../src/utils/loans.js";
import type { ClubStint } from "../../src/types/player.js";

const stint = (club: string, seasons: string[]): ClubStint => ({ club, clubId: club, seasons });

describe("markLoanStints", () => {
  it("flags short spells nested inside a longer parent stint (the Woodman case)", () => {
    const clubs = [
      stint("Newcastle", ["2014-15", "2015-16", "2018-19", "2019-20", "2020-21"]),
      stint("Kilmarnock", ["2016-17"]),
      stint("Aberdeen", ["2017-18"]),
      stint("Swansea", ["2019-20", "2020-21"]),
    ];
    markLoanStints(clubs);
    const loan = Object.fromEntries(clubs.map((c) => [c.club, !!c.loan]));
    expect(loan).toEqual({ Newcastle: false, Kilmarnock: true, Aberdeen: true, Swansea: true });
  });

  it("does not flag a permanent transfer (non-nested consecutive stints)", () => {
    const clubs = [
      stint("Newcastle", ["2014-15", "2015-16"]),
      stint("Swansea", ["2016-17", "2017-18", "2018-19"]),
    ];
    markLoanStints(clubs);
    expect(clubs.every((c) => !c.loan)).toBe(true);
  });

  it("does not flag equal-width overlapping stints", () => {
    const clubs = [stint("A", ["2010-11"]), stint("B", ["2010-11"])];
    markLoanStints(clubs);
    expect(clubs.every((c) => !c.loan)).toBe(true);
  });

  it("ignores stints with no parseable seasons", () => {
    const clubs = [stint("A", []), stint("B", ["2010-11", "2011-12", "2012-13"])];
    markLoanStints(clubs);
    expect(clubs.every((c) => !c.loan)).toBe(true);
  });
});
