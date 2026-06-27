import type { Client } from "pg";

export interface ReepMaps {
  /** `${source}:${sourceId}` -> reep_id */
  toReep: Map<string, string>;
  /** reep_id -> canonical name/dob (for filling player metadata) */
  meta: Map<string, { name: string; dob: string | null }>;
}

/** Load the reep id maps (populated by load-reep.ts) into memory. */
export async function loadReepMaps(client: Client): Promise<ReepMaps> {
  const toReep = new Map<string, string>();
  const meta = new Map<string, { name: string; dob: string | null }>();

  const m = await client.query<{ source: string; source_id: string; reep_id: string }>(
    `SELECT source, source_id, reep_id FROM reep_map`
  );
  for (const r of m.rows) toReep.set(`${r.source}:${r.source_id}`, r.reep_id);

  const p = await client.query<{ reep_id: string; name: string | null; date_of_birth: string | null }>(
    `SELECT reep_id, name, date_of_birth FROM reep_people`
  );
  for (const r of p.rows) meta.set(r.reep_id, { name: r.name ?? "", dob: r.date_of_birth });

  return { toReep, meta };
}

/**
 * Canonical player id for a provider's id. Returns the shared `reep_id` when reep
 * knows this player (so the same person from different sources collapses to one
 * node), else a source-prefixed fallback so source-exclusive players still exist.
 */
export function canonicalId(maps: ReepMaps | null, source: string, sourceId: string): string {
  const reep = maps?.toReep.get(`${source}:${sourceId}`);
  return reep ?? `${source.slice(0, 2)}:${sourceId}`;
}
