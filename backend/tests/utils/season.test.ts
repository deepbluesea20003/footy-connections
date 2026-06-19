import { describe, it, expect } from "vitest";
import { seasonLabel, seasonStartYear, seasonsBetween } from "../../src/utils/season.js";

const OPTS = { minYear: 1888, currentSeasonStartYear: 2025 };

describe("seasonLabel", () => {
  it("formats English season labels", () => {
    expect(seasonLabel(1995)).toBe("1995-96");
    expect(seasonLabel(1999)).toBe("1999-00");
    expect(seasonLabel(2009)).toBe("2009-10");
  });
});

describe("seasonStartYear", () => {
  it("treats exact Jan-1 as year precision", () => {
    expect(seasonStartYear("1993-01-01")).toBe(1993);
  });
  it("maps Jul–Dec to the season starting that year", () => {
    expect(seasonStartYear("2021-08-15")).toBe(2021);
  });
  it("maps Jan–Jun to the previous season", () => {
    expect(seasonStartYear("2022-02-20")).toBe(2021);
  });
  it("returns null for missing or malformed input", () => {
    expect(seasonStartYear(null)).toBeNull();
    expect(seasonStartYear("http://example.com")).toBeNull();
  });
});

describe("seasonsBetween", () => {
  it("expands a multi-year stint inclusively", () => {
    expect(seasonsBetween("2018-07-01", "2021-06-30", OPTS)).toEqual(["2018-19", "2019-20", "2020-21"]);
  });

  it("handles year-precision ranges", () => {
    expect(seasonsBetween("1993-01-01", "1996-01-01", OPTS)).toEqual([
      "1993-94", "1994-95", "1995-96",
    ]);
  });

  it("returns empty when the start is unbounded (no false edges)", () => {
    expect(seasonsBetween(null, "2000-01-01", OPTS)).toEqual([]);
  });

  it("extends a recent open-ended stint to the current season", () => {
    expect(seasonsBetween("2023-08-01", null, OPTS)).toEqual(["2023-24", "2024-25", "2025-26"]);
  });

  it("does NOT extend an old open-ended stint for decades", () => {
    // Started 1955, no end recorded → keep only the start season, not 1955→2025.
    expect(seasonsBetween("1955-08-01", null, OPTS)).toEqual(["1955-56"]);
  });

  it("clamps to the minimum year", () => {
    const seasons = seasonsBetween("1880-01-01", "1892-01-01", { minYear: 1888, currentSeasonStartYear: 2025 });
    expect(seasons[0]).toBe("1888-89");
  });

  it("treats a future end date (vandalism) as a single bounded season", () => {
    // Real Wikidata vandalism on Q10490646: Man City start 2001, end 2078.
    // Must NOT fill 2001→2025 and make the player a 25-season phantom hub.
    expect(seasonsBetween("2001-01-01", "2078-01-01", OPTS)).toEqual(["2001-02"]);
    expect(seasonsBetween("2007-01-01", "2625-01-01", OPTS)).toEqual(["2007-08"]);
    expect(seasonsBetween("2009-01-01", "20009-01-01", OPTS)).toEqual(["2009-10"]);
  });

  it("treats an end before the start as a single bounded season", () => {
    expect(seasonsBetween("2010-08-01", "2008-06-30", OPTS)).toEqual(["2010-11"]);
  });

  it("treats an unparseable but present end as a single bounded season", () => {
    expect(seasonsBetween("2015-08-01", "http://garbage", OPTS)).toEqual(["2015-16"]);
  });

  it("caps an implausibly long stint to MAX_STINT_YEARS", () => {
    // A ~40-year single-club span is itself bad data; clamp it rather than
    // emitting 40 seasons of teammate edges.
    const seasons = seasonsBetween("1980-08-01", "2020-06-30", OPTS);
    expect(seasons[0]).toBe("1980-81");
    expect(seasons[seasons.length - 1]).toBe("2010-11"); // 1980 + 30
  });
});
