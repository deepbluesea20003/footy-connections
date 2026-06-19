export function normalize(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

export function slugify(name: string): string {
  return normalize(name).replace(/\s+/g, "-");
}

/** Strip trailing club-type suffixes (F.C., A.F.C., S.C., C.F.) for nicer
 *  display names. Identity is keyed on the Wikidata QID, not this string. */
export function normalizeClubName(name: string): string {
  return name
    .replace(/\s+(?:f\.?\s*c\.?|a\.?\s*f\.?\s*c\.?|s\.?\s*c\.?|c\.?\s*f\.?)$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0)
  );

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }

  return dp[m][n];
}
