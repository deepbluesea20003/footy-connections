/**
 * Build a Wikimedia Commons thumbnail URL from a stored P18 filename.
 *
 * We persist only the filename segment that follows `Special:FilePath/` (as it
 * comes back from Wikidata — already URL-encoded), then rebuild a sized thumb
 * on demand. Special:FilePath redirects to a scaled rendition for the requested
 * width, so the browser only ever pulls a small image, served free by Wikimedia.
 */
export function commonsThumbUrl(imageFile: string, width = 80): string {
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${imageFile}?width=${width}`;
}
