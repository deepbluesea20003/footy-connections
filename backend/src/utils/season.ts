/**
 * Season helpers for mapping Wikidata membership date ranges onto English-style
 * seasons ("1995-96"). Dates from Wikidata are frequently year-granularity
 * (stored as YYYY-01-01); we treat an exact Jan-1 as year precision rather than
 * a literal January transfer to avoid systematically shifting stints back a year.
 */

export function seasonLabel(startYear: number): string {
  const end = String((startYear + 1) % 100).padStart(2, "0");
  return `${startYear}-${end}`;
}

/**
 * The start year of the season a date falls in. English seasons run Aug–May, so
 * a date in Jul–Dec belongs to season starting that year; Jan–Jun to the season
 * that started the previous year. Exact Jan-1 is treated as year-precision and
 * mapped to the season starting that year.
 */
export function seasonStartYear(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const m = /^([+-]?\d{1,6})-(\d{2})-(\d{2})/.exec(String(dateStr));
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  if (!Number.isFinite(year) || month < 1 || month > 12) return null;
  if (month === 1 && day === 1) return year; // year precision
  return month >= 7 ? year : year - 1;
}

export interface SeasonRangeOpts {
  minYear: number;
  currentSeasonStartYear: number;
  /** If the end date is missing, only extend to the current season when the
   *  stint started within this many years (a player plausibly still active).
   *  Otherwise we keep just the start season to avoid inventing decades of
   *  false teammate edges for old players with no recorded end date. */
  assumeActiveWithinYears?: number;
}

/**
 * The start year of the last full season a leave-date covers. Year-precision
 * (exact Jan-1) means "left during that year", so the last full season started
 * the year before; a dated leave mid-season counts that season as played.
 */
function endSeasonStartYear(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const m = /^([+-]?\d{1,6})-(\d{2})-(\d{2})/.exec(String(dateStr));
  if (!m) return null;
  const year = parseInt(m[1], 10);
  if (m[2] === "01" && m[3] === "01") return year - 1; // year precision
  return seasonStartYear(dateStr);
}

export function seasonsBetween(
  start: string | null,
  end: string | null,
  opts: SeasonRangeOpts
): string[] {
  const sy = seasonStartYear(start);
  if (sy === null) return []; // unbounded start → cannot place; skip

  // ey is null when the end is missing OR unparseable (e.g. a garbage value).
  let ey = endSeasonStartYear(end);
  if (ey === null) {
    const within = opts.assumeActiveWithinYears ?? 25;
    ey = opts.currentSeasonStartYear - sy <= within ? opts.currentSeasonStartYear : sy;
  }

  const from = Math.max(sy, opts.minYear);
  const to = Math.min(ey, opts.currentSeasonStartYear);

  const seasons: string[] = [];
  for (let y = from; y <= to; y++) seasons.push(seasonLabel(y));

  // A single-year stint (start year == leave year) yields an empty range above;
  // record the start season so the player still appears in that squad.
  if (seasons.length === 0 && sy >= opts.minYear && sy <= opts.currentSeasonStartYear) {
    seasons.push(seasonLabel(sy));
  }
  return seasons;
}
