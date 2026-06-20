const isQid = (id?: string | null): id is string => !!id && /^Q\d+$/.test(id);

export function wikidataUrl(id?: string | null): string | null {
  return isQid(id) ? `https://www.wikidata.org/wiki/${id}` : null;
}

/** English-Wikipedia deep link via Wikidata's GoToLinkedPage redirect. */
export function wikipediaUrl(id?: string | null): string | null {
  return isQid(id)
    ? `https://www.wikidata.org/wiki/Special:GoToLinkedPage?site=enwiki&itemid=${id}`
    : null;
}
