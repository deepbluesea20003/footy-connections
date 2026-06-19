/**
 * Seeds Neon DB from the existing hardcoded player data.
 * Run with: DATABASE_URL=... npx tsx src/scripts/seed-db.ts
 *
 * Routes every player through the identity resolver so the seed shares the same
 * dedup logic as the API importer (source = "seed").
 */
import { neon } from "@neondatabase/serverless";
import { players } from "../data/index.js";
import { slugify } from "../utils/string.js";
import { createIdentityResolver } from "../db/player-identity.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function seed() {
  console.log(`Seeding ${players.length} players...`);
  const resolver = createIdentityResolver(sql);

  const clubs = new Map<string, string>();
  for (const player of players) {
    for (const stint of player.clubs) {
      clubs.set(slugify(stint.club), stint.club);
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
    const playerId = await resolver.resolveOrCreatePlayer({
      name: player.name,
      dateOfBirth: player.dateOfBirth ?? null,
      nationality: player.nationality ?? null,
      source: "seed",
    });

    for (const stint of player.clubs) {
      const clubId = slugify(stint.club);
      for (const season of stint.seasons) {
        await sql`
          INSERT INTO player_club_seasons (player_id, club_id, season)
          VALUES (${playerId}, ${clubId}, ${season})
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
