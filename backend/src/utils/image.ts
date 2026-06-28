/** Transfermarkt club crest URL, derived from the club id. */
export function crestUrl(clubId: string): string {
  return `https://tmssl.akamaized.net/images/wappen/head/${clubId}.png`;
}

/** Upgrade a Transfermarkt portrait URL to the high-res `big` variant (300×390,
 *  vs the stored `header` at 139×181) so faces stay crisp when rendered large.
 *  `big` is reliably available for every portrait; leaves non-TM URLs untouched. */
export function bigPortrait(url?: string | null): string | undefined {
  if (!url) return undefined;
  return url.replace(/\/portrait\/(?:small|medium|header|big)\//, "/portrait/big/");
}
