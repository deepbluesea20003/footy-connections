/**
 * Recomputes players.popularity — the search-ranking signal.
 *
 * v1 was simply ln(1 + market_value), which is 0 for anyone without a recorded
 * market value: pre-market-value greats, lower-tier pros, and obscure namesakes
 * all flatlined at 0 and sorted arbitrarily. So an old real footballer could sit
 * below — or indistinguishable from — a same-name nobody in search results.
 *
 * v2 keeps market value as the primary signal (UNCHANGED for anyone who has one,
 * so the game's popularity-tuned difficulty floors still hold) and, only for the
 * market-value-less tail, substitutes a top-5-league appearance signal. So a
 * player with real Big-5 minutes outranks a namesake with none. The appearance
 * term is capped below the game's lowest fame floor (16) so it never lifts an
 * unpriced player into the puzzle-eligible band — that stays reserved for
 * genuinely valuable stars.
 *
 * Idempotent full recompute. Runs after reconcile-identities so merged nodes are
 * scored on their combined appearances.
 *
 * Run: DATABASE_URL=... npm run recompute:pop --workspace=backend
 */
import { Client } from "pg";
import { directUrl } from "../db/pg-url.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

// The five major European leagues (Transfermarkt competition ids), mirroring
// game.ts BIG5 — the leagues we prioritise for recognisable players.
const BIG5 = ["GB1", "ES1", "IT1", "L1", "FR1"];
const ts = () => new Date().toISOString().slice(11, 19);

async function main() {
  const client = new Client({ connectionString: directUrl(DATABASE_URL!), ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    console.log(`[${ts()}] recomputing popularity (market value, else Big-5 appearances)…`);
    const res = await client.query(
      `UPDATE players p SET popularity = CASE
         WHEN COALESCE(p.market_value, 0) > 0 THEN ln(1 + p.market_value)
         ELSE least(15.0, 0.9 * ln(1 + (
           SELECT count(*) FROM game_lineups gl
           JOIN games g ON g.id = gl.game_id
           WHERE gl.player_id = p.id AND g.competition_id = ANY($1)
         )))
       END`,
      [BIG5]
    );
    console.log(`[${ts()}] DONE — ${res.rowCount?.toLocaleString()} players scored`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
