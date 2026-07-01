/**
 * Folds orphan player nodes into their canonical reep node, fixing the
 * same-person-split-in-two problem (e.g. Shane Long's lower-tier API-Football
 * profile living as a separate node from his top-flight reep node, which breaks
 * chains through his lower-league career).
 *
 * Why a post-import pass rather than resolution at ingest: the API-Football
 * source carries no date of birth, so `canonicalId()`'s id-map + name+DOB dedup
 * can't fuse those rows — they fall back to standalone `ap:`/`tr:` nodes. But the
 * reep register (`reep_people`) is a curated identity list, so when a name is
 * UNIQUE there, reep is asserting only one such footballer exists — an orphan
 * with that exact name is almost certainly that person. That's the one signal we
 * have, and it resolves the split cleanly for the unambiguous majority.
 *
 * Merge = repoint every `game_lineups` row from the orphan id to the canonical
 * reep id, then delete the orphan `players` row. game_lineups is the only table
 * keyed on player id, and the graph de-dupes rosters, so this is safe. It's a
 * DERIVED step: the whole DB is rebuilt from scratch each data-job run, so a bad
 * merge is wiped on the next reload — this pass just re-runs after the imports.
 *
 * Ambiguous names (>1 reep person, e.g. several "David Silva"s) are left alone —
 * we can't disambiguate without a DOB the source doesn't provide.
 *
 * Dry-run by default (prints counts + a sample, mutates nothing). Pass --apply to
 * perform the merge. Test against a Neon branch first:
 *   DATABASE_URL=<branch-url> npm run reconcile --workspace=backend -- --apply
 */
import { Client } from "pg";
import { directUrl } from "../db/pg-url.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const APPLY = process.argv.includes("--apply");
const ts = () => new Date().toISOString().slice(11, 19);

// Orphan (ap:/tr:) -> canonical reep id, when the orphan's normalized name is
// UNIQUE in reep_people and that reep person exists as a node we imported.
const MERGE_CTE = `
  WITH reep_unique AS (
    SELECT lower(f_unaccent(name)) AS nn, min(reep_id) AS rid
    FROM reep_people
    GROUP BY 1 HAVING count(*) = 1
  ),
  present AS (
    SELECT ru.nn, ru.rid FROM reep_unique ru JOIN players p ON p.id = ru.rid
  ),
  merges AS (
    SELECT o.id AS orphan, pr.rid AS canonical
    FROM players o
    JOIN present pr ON pr.nn = lower(f_unaccent(o.name))
    WHERE (o.id LIKE 'ap:%' OR o.id LIKE 'tr:%') AND o.id <> pr.rid
  )
`;

async function main() {
  const client = new Client({ connectionString: directUrl(DATABASE_URL!), ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const before = (await client.query(`SELECT count(*)::int AS n FROM players`)).rows[0].n as number;

    const summary = await client.query(`
      ${MERGE_CTE}
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE orphan LIKE 'ap:%')::int AS ap,
        count(*) FILTER (WHERE orphan LIKE 'tr:%')::int AS tr,
        count(DISTINCT canonical)::int AS canonical_nodes
      FROM merges
    `);
    const s = summary.rows[0];
    console.log(`[${ts()}] ${before.toLocaleString()} players; ${s.total.toLocaleString()} orphans to merge ` +
      `(${s.ap} ap:, ${s.tr} tr:) into ${s.canonical_nodes.toLocaleString()} reep nodes`);

    const sample = await client.query(`
      ${MERGE_CTE}
      SELECT o.name AS orphan_name, o.id AS orphan_id, r.name AS reep_name,
             to_char(r.date_of_birth,'YYYY-MM-DD') AS dob,
             (SELECT count(*) FROM game_lineups gl WHERE gl.player_id = m.orphan) AS orphan_apps
      FROM merges m
      JOIN players o ON o.id = m.orphan
      JOIN players r ON r.id = m.canonical
      ORDER BY orphan_apps DESC
      LIMIT 15
    `);
    console.log(`[${ts()}] top merges by orphan appearances:`);
    for (const r of sample.rows) {
      console.log(`   ${r.orphan_name} (${r.orphan_id}, ${r.orphan_apps} apps) → ${r.reep_name} [b. ${r.dob ?? "?"}]`);
    }

    if (!APPLY) {
      console.log(`[${ts()}] DRY RUN — nothing changed. Re-run with --apply to merge.`);
      return;
    }

    await client.query("BEGIN");
    const upd = await client.query(`
      ${MERGE_CTE}
      UPDATE game_lineups gl SET player_id = m.canonical
      FROM merges m WHERE gl.player_id = m.orphan
    `);
    const del = await client.query(`
      ${MERGE_CTE}
      DELETE FROM players p USING merges m WHERE p.id = m.orphan
    `);
    await client.query("COMMIT");

    const after = (await client.query(`SELECT count(*)::int AS n FROM players`)).rows[0].n as number;
    console.log(`[${ts()}] APPLIED — repointed ${upd.rowCount?.toLocaleString()} lineup rows, ` +
      `removed ${del.rowCount?.toLocaleString()} orphan players (${before.toLocaleString()} → ${after.toLocaleString()})`);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
