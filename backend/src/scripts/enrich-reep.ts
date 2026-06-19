/**
 * Stamps each player with a stable reep canonical ID (https://github.com/withqwerty/reep).
 *
 * reep is a CC0 cross-provider football identity register. Its people.csv maps a
 * reep_id to a Wikidata QID (and to 30+ other providers' IDs). We already store
 * each player's Wikidata QID in player_external_ids (source='wikidata'), so we
 * join on the QID to attach players.reep_id — giving every player one stable,
 * provider-agnostic identifier for the search work to key on.
 *
 * Run: DATABASE_URL=... npm run enrich:reep --workspace=backend
 */
import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}
const sql = neon(DATABASE_URL);

const PEOPLE_CSV = process.env.REEP_PEOPLE_CSV ?? "https://raw.githubusercontent.com/withqwerty/reep/main/data/people.csv";

function ts() { return new Date().toISOString().substring(11, 19); }

/** reep_id and key_wikidata are always the first two columns and never contain
 *  commas/quotes, so we can split just the leading fields without a CSV parser. */
function parseQidMap(csv: string): Map<string, string> {
  const map = new Map<string, string>();
  let nl = csv.indexOf("\n"); // skip header
  let start = nl + 1;
  while (start < csv.length) {
    nl = csv.indexOf("\n", start);
    const end = nl === -1 ? csv.length : nl;
    const line = csv.slice(start, end);
    start = end + 1;
    const c1 = line.indexOf(",");
    if (c1 === -1) continue;
    const c2 = line.indexOf(",", c1 + 1);
    const reepId = line.slice(0, c1);
    const qid = line.slice(c1 + 1, c2 === -1 ? line.length : c2);
    if (qid && /^Q\d+$/.test(qid)) map.set(qid, reepId);
  }
  return map;
}

async function main() {
  console.log(`[${ts()}] adding players.reep_id column...`);
  await sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS reep_id TEXT`;
  await sql`CREATE INDEX IF NOT EXISTS idx_players_reep ON players(reep_id)`;

  console.log(`[${ts()}] downloading reep people.csv...`);
  const res = await fetch(PEOPLE_CSV, { headers: { "User-Agent": "footy-connections/0.1" } });
  if (!res.ok) throw new Error(`failed to fetch reep CSV: HTTP ${res.status}`);
  const csv = await res.text();
  const qidToReep = parseQidMap(csv);
  console.log(`[${ts()}] reep map: ${qidToReep.size} wikidata→reep mappings`);

  // Walk our wikidata-mapped players in pages, collecting reep matches to bulk-update.
  let cursor = "";
  let scanned = 0;
  let matched = 0;
  const CHUNK = 5000;

  while (true) {
    const rows = (await sql`
      SELECT player_id, external_id FROM player_external_ids
      WHERE source = 'wikidata' AND player_id > ${cursor}
      ORDER BY player_id LIMIT ${CHUNK}`) as { player_id: string; external_id: string }[];
    if (rows.length === 0) break;

    const pids: string[] = [];
    const reeps: string[] = [];
    for (const r of rows) {
      const reep = qidToReep.get(r.external_id);
      if (reep) { pids.push(r.player_id); reeps.push(reep); }
    }
    if (pids.length > 0) {
      await sql`
        UPDATE players SET reep_id = m.reep
        FROM unnest(${pids}::text[], ${reeps}::text[]) AS m(pid, reep)
        WHERE players.id = m.pid`;
      matched += pids.length;
    }
    scanned += rows.length;
    cursor = rows[rows.length - 1].player_id;
    console.log(`[${ts()}] scanned ${scanned}, reep-matched ${matched}`);
  }

  const [{ total }] = (await sql`SELECT COUNT(*)::text AS total FROM players`) as [{ total: string }];
  const [{ withReep }] = (await sql`SELECT COUNT(*)::text AS "withReep" FROM players WHERE reep_id IS NOT NULL`) as [{ withReep: string }];
  console.log(`[${ts()}] DONE — ${withReep}/${total} players now have a reep_id`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
