import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Player } from "../types/player.js";

// Bump when the cached shape changes so old caches are ignored rather than
// deserialized into the wrong structure.
const CACHE_VERSION = 1;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CACHE_PATH = path.join(__dirname, "../../.cache/players.json");

function cachePath(): string {
  return process.env.PLAYER_CACHE_PATH || DEFAULT_CACHE_PATH;
}

function disabled(): boolean {
  return process.env.PLAYER_CACHE === "off";
}

interface CacheFile {
  version: number;
  /** players row count at cache time — the staleness signal (see readPlayerCache). */
  count: number;
  players: Player[];
}

/**
 * Returns the cached player list, or null if there's no usable cache.
 *
 * `expectedCount` is the current `players` row count (one cheap COUNT query at
 * boot). If it differs from the count stored in the cache, the importer has
 * changed the data and we treat the cache as stale. Set PLAYER_CACHE=off to
 * bypass entirely.
 */
export function readPlayerCache(expectedCount: number): Player[] | null {
  if (disabled()) return null;
  try {
    const data = JSON.parse(fs.readFileSync(cachePath(), "utf8")) as CacheFile;
    if (data.version !== CACHE_VERSION) return null;
    if (data.count !== expectedCount) return null;
    return data.players;
  } catch {
    // Missing or corrupt cache — caller falls back to loading from the DB.
    return null;
  }
}

export function writePlayerCache(players: Player[], count: number): void {
  if (disabled()) return;
  const file = cachePath();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const payload: CacheFile = { version: CACHE_VERSION, count, players };
    // Write to a temp file then rename so a crash mid-write can't leave a
    // truncated cache that later parses partially.
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(payload));
    fs.renameSync(tmp, file);
  } catch (err) {
    console.warn("Failed to write player cache:", (err as Error).message);
  }
}
