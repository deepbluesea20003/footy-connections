/**
 * Prints a snapshot of the data-import progress. Run: npm run status
 */
import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("DATABASE_URL is required"); process.exit(1); }
const sql = neon(DATABASE_URL);

const BUDGET = 440 * 1024 * 1024;

function bar(pct: number, width = 30): string {
  const filled = Math.round((pct / 100) * width);
  return "[" + "#".repeat(filled) + "-".repeat(width - filled) + "]";
}

async function main() {
  const [q] = (await sql`
    SELECT
      (SELECT COUNT(*) FROM import_club_queue WHERE status='done') AS done,
      (SELECT COUNT(*) FROM import_club_queue WHERE status='pending') AS pending,
      (SELECT COUNT(*) FROM import_club_queue WHERE status='error') AS error,
      (SELECT COUNT(*) FROM players) AS players,
      (SELECT COUNT(*) FROM player_club_seasons) AS seasons,
      (SELECT COALESCE((SELECT phase FROM import_jobs WHERE id='wikidata'),'(not started)')) AS phase,
      pg_database_size(current_database()) AS bytes
  `) as [{ done: number; pending: number; error: number; players: number; seasons: number; phase: string; bytes: number }];

  // reep_id column only exists after enrichment has run.
  let reep = 0;
  try {
    const [r] = (await sql`SELECT COUNT(*) AS reep FROM players WHERE reep_id IS NOT NULL`) as [{ reep: number }];
    reep = Number(r.reep);
  } catch { /* column not added yet */ }

  const totalClubs = Number(q.done) + Number(q.pending) + Number(q.error);
  const clubPct = totalClubs ? (Number(q.done) / totalClubs) * 100 : 0;
  const budgetPct = (Number(q.bytes) / BUDGET) * 100;
  const mb = (Number(q.bytes) / 1024 / 1024).toFixed(0);

  console.log(`\n  Football data import — phase: ${q.phase}\n`);
  console.log(`  Clubs    ${bar(clubPct)} ${Number(q.done).toLocaleString()}/${totalClubs.toLocaleString()} (${clubPct.toFixed(1)}%)  ${Number(q.error) ? q.error + " errored" : ""}`);
  console.log(`  Storage  ${bar(budgetPct)} ${mb} MB / 440 MB (${budgetPct.toFixed(1)}%)`);
  console.log(`\n  Players:        ${Number(q.players).toLocaleString()}`);
  console.log(`  Club-seasons:   ${Number(q.seasons).toLocaleString()}`);
  console.log(`  reep IDs:       ${reep.toLocaleString()}${reep === 0 ? "  (run after import: npm run enrich:reep)" : ""}`);
  console.log("");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
