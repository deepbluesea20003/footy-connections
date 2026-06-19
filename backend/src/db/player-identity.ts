import { type NeonQueryFunction } from "@neondatabase/serverless";
import { slugify, normalize } from "../utils/string.js";

type Sql = NeonQueryFunction<false, false>;

export interface PlayerIdentityInput {
  name: string;
  dateOfBirth?: string | null; // YYYY-MM-DD
  nationality?: string | null;
  /** Data source name, e.g. "seed", "football-data", "fbref". */
  source: string;
  /** Stable provider-specific ID, if the source has one. */
  externalId?: string | null;
}

export function birthYear(dateOfBirth?: string | null): string | null {
  if (!dateOfBirth) return null;
  const year = String(dateOfBirth).slice(0, 4);
  return /^\d{4}$/.test(year) ? year : null;
}

/**
 * Ordered list of candidate slugs for a player, most-preferred first:
 *   erling-haaland, erling-haaland-2000, erling-haaland-2000-2, ...
 * The birth year is the first disambiguator so colliding names stay readable.
 * Pure + deterministic — unit tested independently of the DB.
 */
export function slugCandidates(name: string, dateOfBirth?: string | null): string[] {
  const base = slugify(name);
  const yr = birthYear(dateOfBirth);
  const list = [base];
  if (yr) list.push(`${base}-${yr}`);
  for (let n = 2; n <= 9; n++) {
    list.push(yr ? `${base}-${yr}-${n}` : `${base}-${n}`);
  }
  return list;
}

/** First candidate slug not already taken. Pure — `taken` is the set of used IDs. */
export function pickUniqueId(
  name: string,
  dateOfBirth: string | null | undefined,
  taken: Set<string>
): string {
  for (const candidate of slugCandidates(name, dateOfBirth)) {
    if (!taken.has(candidate)) return candidate;
  }
  return `${slugify(name)}-${Date.now()}`;
}

function identityKey(name: string, dateOfBirth?: string | null): string {
  return `${normalize(name)}::${dateOfBirth ?? ""}`;
}

/**
 * Resolves incoming player records to a single canonical player row, deduping
 * across data sources. Resolution order:
 *   1. (source, externalId) — fast idempotent re-sync of a known provider.
 *   2. normalized(name) + date_of_birth — the universal cross-source key.
 *   3. normalized(name) with a not-yet-known DOB — merges a DOB-less seed row
 *      into the richer record once a source supplies the birth date.
 *   4. Otherwise create a new canonical player with a unique slug.
 *
 * Caches are loaded once and kept in sync with inserts, so a batch of thousands
 * of upserts stays efficient.
 */
export interface InMemoryResolution {
  playerId: string;
  /** Present when a brand-new canonical player was created (bulk-insert it). */
  newPlayer?: { id: string; name: string; dateOfBirth: string | null; nationality: string | null };
  /** Present when this (source, externalId) was newly mapped (bulk-insert it). */
  newExternalId?: { source: string; externalId: string; playerId: string };
}

export function createIdentityResolver(sql: Sql) {
  const takenIds = new Set<string>();
  const byExternal = new Map<string, string>(); // `${source}::${externalId}` -> playerId
  const byIdentity = new Map<string, string>(); // `${normName}::${dob}` -> playerId
  let loaded = false;

  async function ensureLoaded() {
    if (loaded) return;
    loaded = true;

    // Paginate both loads — a single SELECT over hundreds of thousands of rows
    // is slow and can be truncated/reset by the serverless HTTP driver.
    const PAGE = 20000;

    let pCursor = "";
    for (;;) {
      const page = (await sql`
        SELECT id, name, to_char(date_of_birth, 'YYYY-MM-DD') AS date_of_birth
        FROM players WHERE id > ${pCursor} ORDER BY id LIMIT ${PAGE}
      `) as { id: string; name: string; date_of_birth: string | null }[];
      if (page.length === 0) break;
      for (const p of page) {
        takenIds.add(p.id);
        byIdentity.set(identityKey(p.name, p.date_of_birth), p.id);
      }
      pCursor = page[page.length - 1].id;
      if (page.length < PAGE) break;
    }

    let ePid = "";
    let eExt = "";
    for (;;) {
      const page = (await sql`
        SELECT source, external_id, player_id FROM player_external_ids
        WHERE (player_id, external_id) > (${ePid}, ${eExt})
        ORDER BY player_id, external_id LIMIT ${PAGE}
      `) as { source: string; external_id: string; player_id: string }[];
      if (page.length === 0) break;
      for (const e of page) {
        byExternal.set(`${e.source}::${e.external_id}`, e.player_id);
      }
      ePid = page[page.length - 1].player_id;
      eExt = page[page.length - 1].external_id;
      if (page.length < PAGE) break;
    }
  }

  async function recordExternalId(source: string, externalId: string, playerId: string) {
    const key = `${source}::${externalId}`;
    if (byExternal.has(key)) return;
    await sql`
      INSERT INTO player_external_ids (source, external_id, player_id)
      VALUES (${source}, ${externalId}, ${playerId})
      ON CONFLICT DO NOTHING
    `;
    byExternal.set(key, playerId);
  }

  async function backfill(playerId: string, dob: string | null, nationality: string | null) {
    if (dob) {
      await sql`UPDATE players SET date_of_birth = ${dob} WHERE id = ${playerId} AND date_of_birth IS NULL`;
    }
    if (nationality) {
      await sql`UPDATE players SET nationality = ${nationality} WHERE id = ${playerId} AND nationality IS NULL`;
    }
  }

  async function resolveOrCreatePlayer(input: PlayerIdentityInput): Promise<string> {
    await ensureLoaded();

    const dob = input.dateOfBirth ? String(input.dateOfBirth).slice(0, 10) : null;
    const nationality = input.nationality ?? null;

    // 1. Known provider ID.
    if (input.externalId) {
      const pid = byExternal.get(`${input.source}::${input.externalId}`);
      if (pid) {
        await backfill(pid, dob, nationality);
        return pid;
      }
    }

    // 2. Exact identity (name + DOB).
    const idKey = identityKey(input.name, dob);
    let pid = byIdentity.get(idKey);

    // 3. Merge a DOB-less existing row once we learn the DOB.
    if (!pid && dob) {
      const nullKey = identityKey(input.name, null);
      const nullPid = byIdentity.get(nullKey);
      if (nullPid) {
        pid = nullPid;
        byIdentity.delete(nullKey);
        byIdentity.set(idKey, pid);
      }
    }

    if (pid) {
      await backfill(pid, dob, nationality);
      if (input.externalId) await recordExternalId(input.source, input.externalId, pid);
      return pid;
    }

    // 4. Create a new canonical player.
    pid = pickUniqueId(input.name, dob, takenIds);
    await sql`
      INSERT INTO players (id, name, date_of_birth, nationality)
      VALUES (${pid}, ${input.name}, ${dob}, ${nationality})
      ON CONFLICT (id) DO NOTHING
    `;
    takenIds.add(pid);
    byIdentity.set(idKey, pid);
    if (input.externalId) await recordExternalId(input.source, input.externalId, pid);
    return pid;
  }

  /** Pre-load caches so resolveInMemory() can run without per-call DB reads. */
  async function load() {
    await ensureLoaded();
  }

  /**
   * Synchronous, DB-write-free resolution for bulk importing. Mirrors the
   * resolveOrCreatePlayer dedup logic but only mutates the in-memory caches and
   * returns the records the caller should bulk-insert. Call load() first.
   * (Skips DOB backfill onto already-existing rows — acceptable for bulk loads,
   * where new players carry their DOB at insert time.)
   */
  function resolveInMemory(input: PlayerIdentityInput): InMemoryResolution {
    const dob = input.dateOfBirth ? String(input.dateOfBirth).slice(0, 10) : null;
    const nationality = input.nationality ?? null;

    if (input.externalId) {
      const pid = byExternal.get(`${input.source}::${input.externalId}`);
      if (pid) return { playerId: pid };
    }

    const idKey = identityKey(input.name, dob);
    let pid = byIdentity.get(idKey);
    if (!pid && dob) {
      const nullKey = identityKey(input.name, null);
      const nullPid = byIdentity.get(nullKey);
      if (nullPid) {
        pid = nullPid;
        byIdentity.delete(nullKey);
        byIdentity.set(idKey, pid);
      }
    }

    const mapExternal = (playerId: string): InMemoryResolution["newExternalId"] => {
      if (!input.externalId) return undefined;
      const key = `${input.source}::${input.externalId}`;
      if (byExternal.has(key)) return undefined;
      byExternal.set(key, playerId);
      return { source: input.source, externalId: input.externalId, playerId };
    };

    if (pid) {
      return { playerId: pid, newExternalId: mapExternal(pid) };
    }

    pid = pickUniqueId(input.name, dob, takenIds);
    takenIds.add(pid);
    byIdentity.set(idKey, pid);
    return {
      playerId: pid,
      newPlayer: { id: pid, name: input.name, dateOfBirth: dob, nationality },
      newExternalId: mapExternal(pid),
    };
  }

  return { resolveOrCreatePlayer, load, resolveInMemory };
}
