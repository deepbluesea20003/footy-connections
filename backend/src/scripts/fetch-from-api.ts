/**
 * Fetches Premier League squads from football-data.org and upserts into Neon.
 * This is a long-running batch job (~20 minutes at safe rate limits).
 *
 * Run with:
 *   DATABASE_URL=... FOOTBALL_DATA_API_KEY=... npx tsx src/scripts/fetch-from-api.ts
 *
 * Free API key at: https://www.football-data.org/client/register
 * Free tier limit: 10 requests/minute. We use 8s delays (~7.5 req/min) to stay safe.
 */
import { neon } from "@neondatabase/serverless";
import { slugify } from "../utils/string.js";
import { createIdentityResolver } from "../db/player-identity.js";

const DATABASE_URL = process.env.DATABASE_URL;
const API_KEY = process.env.FOOTBALL_DATA_API_KEY;

if (!DATABASE_URL || !API_KEY) {
  console.error("DATABASE_URL and FOOTBALL_DATA_API_KEY env vars are required");
  process.exit(1);
}

const sql = neon(DATABASE_URL);
const resolver = createIdentityResolver(sql);
const SOURCE = "football-data";
const BASE_URL = "https://api.football-data.org/v4";

// Seasons to fetch: 2019-20 through 2024-25
const SEASONS = [2019, 2020, 2021, 2022, 2023, 2024];

const RATE_LIMIT_DELAY_MS = 8000;         // 8s between requests → ≈7.5 req/min
const RETRY_DELAYS_MS = [15000, 30000, 60000]; // exponential backoff for 429/5xx

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function timestamp() {
  return new Date().toISOString().substring(11, 19);
}

async function fetchWithRetry(url: string): Promise<unknown> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_DELAYS_MS[attempt - 1];
      console.log(`  [${timestamp()}] Retry ${attempt}/${RETRY_DELAYS_MS.length} after ${delay / 1000}s...`);
      await sleep(delay);
    }

    const res = await fetch(url, {
      headers: { "X-Auth-Token": API_KEY! },
    });

    if (res.ok) {
      return res.json();
    }

    if (res.status === 429) {
      const retryAfter = res.headers.get("Retry-After");
      const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : RETRY_DELAYS_MS[attempt] ?? 60000;
      console.warn(`  [${timestamp()}] 429 rate limited — waiting ${waitMs / 1000}s (Retry-After: ${retryAfter ?? "none"})`);
      await sleep(waitMs);
      continue;
    }

    if (res.status >= 500) {
      lastError = new Error(`HTTP ${res.status} from ${url}`);
      continue;
    }

    // 4xx other than 429: permanent failure, skip
    console.warn(`  [${timestamp()}] HTTP ${res.status} for ${url} — skipping`);
    return null;
  }

  console.error(`  [${timestamp()}] Failed after ${RETRY_DELAYS_MS.length + 1} attempts: ${lastError?.message}`);
  return null;
}

interface ApiPlayer {
  id: number;
  name: string;
  nationality: string | null;
  dateOfBirth?: string;
}

interface ApiTeam {
  id: number;
  name: string;
  squad: ApiPlayer[];
}

interface ApiTeamsResponse {
  teams: ApiTeam[];
}

function formatSeason(year: number): string {
  const y2 = String(year + 1).slice(-2);
  return `${year}-${y2}`;
}

async function main() {
  console.log(`[${timestamp()}] Starting PL data fetch for seasons ${SEASONS[0]}-${SEASONS[SEASONS.length - 1]}`);
  console.log(`Rate limit: 1 request every ${RATE_LIMIT_DELAY_MS / 1000}s (~${Math.round(60000 / RATE_LIMIT_DELAY_MS)} req/min)\n`);

  let totalPlayers = 0;
  let totalRows = 0;

  for (const year of SEASONS) {
    const season = formatSeason(year);
    console.log(`\n[${timestamp()}] === Season ${season} ===`);

    const url = `${BASE_URL}/competitions/PL/teams?season=${year}`;
    console.log(`[${timestamp()}] GET ${url}`);

    const data = await fetchWithRetry(url) as ApiTeamsResponse | null;
    if (!data || !data.teams) {
      console.warn(`[${timestamp()}] No data for season ${season}, skipping`);
      await sleep(RATE_LIMIT_DELAY_MS);
      continue;
    }

    console.log(`[${timestamp()}] Got ${data.teams.length} teams`);

    for (const team of data.teams) {
      const clubName = team.name;
      const clubId = slugify(clubName);

      await sql`
        INSERT INTO clubs (id, name)
        VALUES (${clubId}, ${clubName})
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
      `;

      if (!team.squad || team.squad.length === 0) {
        console.log(`  [${timestamp()}] ${clubName}: no squad data in teams response, fetching separately...`);

        await sleep(RATE_LIMIT_DELAY_MS);
        const teamUrl = `${BASE_URL}/teams/${team.id}`;
        console.log(`  [${timestamp()}] GET ${teamUrl}`);
        const teamData = await fetchWithRetry(teamUrl) as { squad?: ApiPlayer[] } | null;
        await sleep(RATE_LIMIT_DELAY_MS);

        if (!teamData?.squad) {
          console.warn(`  [${timestamp()}] ${clubName}: still no squad, skipping`);
          continue;
        }
        team.squad = teamData.squad;
      }

      for (const apiPlayer of team.squad) {
        const playerId = await resolver.resolveOrCreatePlayer({
          name: apiPlayer.name,
          dateOfBirth: apiPlayer.dateOfBirth ?? null,
          nationality: apiPlayer.nationality ?? null,
          source: SOURCE,
          externalId: String(apiPlayer.id),
        });

        await sql`
          INSERT INTO player_club_seasons (player_id, club_id, season)
          VALUES (${playerId}, ${clubId}, ${season})
          ON CONFLICT DO NOTHING
        `;

        totalRows++;
        totalPlayers++;
      }

      console.log(`  [${timestamp()}] ${clubName}: ${team.squad.length} players, ${season}`);
      await sleep(RATE_LIMIT_DELAY_MS);
    }
  }

  const [{ count }] = (await sql`SELECT COUNT(*)::text AS count FROM players`) as [{ count: string }];
  const [{ scount }] = (await sql`SELECT COUNT(*)::text AS scount FROM player_club_seasons`) as [{ scount: string }];
  console.log(`\n[${timestamp()}] Complete. DB now has ${count} players, ${scount} player-club-season rows.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
