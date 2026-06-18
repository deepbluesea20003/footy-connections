/**
 * Seeds Neon DB from the existing hardcoded player data.
 * Run with: DATABASE_URL=... npx tsx src/scripts/seed-db.ts
 */
import { neon } from "@neondatabase/serverless";
import { players } from "../data/index.js";
import { slugify } from "../utils/string.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function seed() {
  console.log(`Seeding ${players.length} players...`);

  const clubs = new Map<string, string>();
  for (const player of players) {
    for (const stint of player.clubs) {
      const clubId = slugify(stint.club);
      clubs.set(clubId, stint.club);
    }
  }

  console.log(`Upserting ${clubs.size} clubs...`);
  for (const [clubId, clubName] of clubs) {
    await sql`
      INSERT INTO clubs (id, name)
      VALUES (${clubId}, ${clubName})
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
    `;
  }

  console.log("Upserting players...");
  for (const player of players) {
    await sql`
      INSERT INTO players (id, name, nationality)
      VALUES (${player.id}, ${player.name}, ${player.nationality ?? null})
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, nationality = EXCLUDED.nationality
    `;

    for (const stint of player.clubs) {
      const clubId = slugify(stint.club);
      for (const season of stint.seasons) {
        await sql`
          INSERT INTO player_club_seasons (player_id, club_id, season)
          VALUES (${player.id}, ${clubId}, ${season})
          ON CONFLICT DO NOTHING
        `;
      }
    }
  }

  const [{ count }] = (await sql`SELECT COUNT(*)::text AS count FROM players`) as [{ count: string }];
  const [{ scount }] = (await sql`SELECT COUNT(*)::text AS scount FROM player_club_seasons`) as [{ scount: string }];
  console.log(`Done. ${count} players, ${scount} player-club-season rows in DB.`);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
