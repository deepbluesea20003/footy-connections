/** Links derived from a Wikidata QID. Only QIDs (e.g. "Q12897") have pages;
 *  seed slugs return null. */
const isQid = (id: string | null | undefined): id is string => !!id && /^Q\d+$/.test(id);

export function wikidataUrl(id: string | null | undefined): string | null {
  return isQid(id) ? `https://www.wikidata.org/wiki/${id}` : null;
}

/** Deep-links to the English Wikipedia article via Wikidata's GoToLinkedPage
 *  redirect — no stored article title needed. Returns null for non-QID ids. */
export function wikipediaUrl(id: string | null | undefined): string | null {
  return isQid(id)
    ? `https://www.wikidata.org/wiki/Special:GoToLinkedPage?site=enwiki&itemid=${id}`
    : null;
}
