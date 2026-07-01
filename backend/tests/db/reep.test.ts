import { describe, it, expect } from "vitest";
import { canonicalId, type ReepMaps } from "../../src/db/reep.js";

describe("canonicalId", () => {
  const maps: ReepMaps = {
    toReep: new Map([["transfermarkt:12345", "reep_abc"]]),
    meta: new Map(),
  };

  it("returns the shared reep_id when reep knows the TM player", () => {
    expect(canonicalId(maps, "transfermarkt", "12345")).toBe("reep_abc");
  });

  it("falls back to a tr: prefix (never a bare numeric id) for unknown players", () => {
    expect(canonicalId(maps, "transfermarkt", "99999")).toBe("tr:99999");
  });

  it("falls back to tr: when reep maps are absent (tables not loaded)", () => {
    expect(canonicalId(null, "transfermarkt", "12345")).toBe("tr:12345");
  });

  it("gives scraper and CSV importer the SAME id for the same TM player", () => {
    // Both scripts call canonicalId(reep, "transfermarkt", tmId); identical
    // inputs must yield identical canonical ids so historical scrape nodes fuse
    // with their modern CSV selves.
    const tmId = "12345";
    const fromScrape = canonicalId(maps, "transfermarkt", tmId);
    const fromImport = canonicalId(maps, "transfermarkt", tmId);
    expect(fromScrape).toBe(fromImport);
    expect(fromScrape).toBe("reep_abc");
  });
});
