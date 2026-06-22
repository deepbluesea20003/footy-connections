/** Transfermarkt club crest URL, derived from the club id. */
export function crestUrl(clubId: string): string {
  return `https://tmssl.akamaized.net/images/wappen/head/${clubId}.png`;
}
