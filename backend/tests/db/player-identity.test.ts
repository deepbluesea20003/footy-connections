import { describe, it, expect } from "vitest";
import { slugCandidates, pickUniqueId, birthYear } from "../../src/db/player-identity.js";

describe("birthYear", () => {
  it("extracts the year from an ISO date", () => {
    expect(birthYear("2000-02-06")).toBe("2000");
  });

  it("returns null for missing or malformed dates", () => {
    expect(birthYear(null)).toBeNull();
    expect(birthYear(undefined)).toBeNull();
    expect(birthYear("nope")).toBeNull();
  });
});

describe("slugCandidates", () => {
  it("puts the bare slug first, then a birth-year suffix", () => {
    const candidates = slugCandidates("Conor Gallagher", "2000-02-06");
    expect(candidates[0]).toBe("conor-gallagher");
    expect(candidates[1]).toBe("conor-gallagher-2000");
  });

  it("falls back to numeric suffixes when DOB is unknown", () => {
    const candidates = slugCandidates("Danny Ward");
    expect(candidates[0]).toBe("danny-ward");
    expect(candidates[1]).toBe("danny-ward-2");
  });
});

describe("pickUniqueId", () => {
  it("returns the bare slug when free", () => {
    expect(pickUniqueId("Cole Palmer", "2002-05-06", new Set())).toBe("cole-palmer");
  });

  it("disambiguates two same-named players by birth year", () => {
    const taken = new Set<string>();
    const first = pickUniqueId("Conor Gallagher", "2000-02-06", taken);
    taken.add(first);
    const second = pickUniqueId("Conor Gallagher", "1995-09-19", taken);
    taken.add(second);

    expect(first).toBe("conor-gallagher");
    expect(second).toBe("conor-gallagher-1995");
    expect(first).not.toBe(second);
  });

  it("handles three-way collisions including same birth year", () => {
    const taken = new Set(["conor-gallagher", "conor-gallagher-2000"]);
    expect(pickUniqueId("Conor Gallagher", "2000-02-06", taken)).toBe("conor-gallagher-2000-2");
  });
});
