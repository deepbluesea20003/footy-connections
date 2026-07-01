import type { ClubStint } from "../types/player.js";

/** Start year of a season label ("2016-17" -> 2016). NaN if unparseable. */
function startYear(season: string): number {
  return parseInt(String(season).slice(0, 4), 10);
}

/** [min, max] start-year span of a stint, or null if it has no parseable seasons. */
function span(stint: ClubStint): [number, number] | null {
  const years = stint.seasons.map(startYear).filter((y) => Number.isFinite(y));
  if (years.length === 0) return null;
  return [Math.min(...years), Math.max(...years)];
}

/**
 * Flags loan stints heuristically, in place. A stint is marked `loan` when its
 * entire year-span nests inside a *strictly wider* span at another club — the
 * signature of a loan spell sitting inside a longer parent-club stint (e.g. a
 * one-season Kilmarnock loan during a 2014–2021 Newcastle stint).
 *
 * Deliberately conservative: it needs a strictly-wider containing stint, so two
 * equal-length or merely adjacent stints never flag each other. Display-only —
 * it never changes the graph edges (loan appearances are real teammate links).
 */
export function markLoanStints(clubs: ClubStint[]): void {
  const spans = clubs.map(span);
  for (let i = 0; i < clubs.length; i++) {
    const s = spans[i];
    if (!s) continue;
    const [sMin, sMax] = s;
    const sWidth = sMax - sMin;
    for (let j = 0; j < clubs.length; j++) {
      if (j === i) continue;
      const p = spans[j];
      if (!p) continue;
      const [pMin, pMax] = p;
      // Parent must contain the candidate's span and be strictly wider.
      if (pMin <= sMin && pMax >= sMax && pMax - pMin > sWidth) {
        clubs[i].loan = true;
        break;
      }
    }
  }
}
