import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";
import type { Player } from "./types/player.js";
import type { BipartiteGraph } from "./types/graph.js";
import { buildGraph } from "./graph/build.js";
import {
  InMemoryPlayerSearchService,
  type PlayerSearchService,
} from "./services/player-search.js";
import { createSeparationRouter } from "./routes/separation.js";
import { createPlayersRouter } from "./routes/players.js";
import { createClubsRouter } from "./routes/clubs.js";
import type { ClubInfo } from "./db/loader.js";

export const app = express();
app.use(cors());
app.use(express.json());

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDist = path.join(__dirname, "../../frontend/dist");
app.use(express.static(frontendDist));

export let graph: BipartiteGraph = { playerToSeasons: new Map(), clubSeasonIndex: new Map() };
export let playerLookup: Map<string, Player> = new Map();
export let clubsById: Map<string, ClubInfo> = new Map();
export let searchService: PlayerSearchService = new InMemoryPlayerSearchService([]);

let initialized = false;

export async function initApp(): Promise<void> {
  if (initialized) return;
  initialized = true;

  let players: Player[];

  if (process.env.DATABASE_URL) {
    const { loadPlayersFromDb, loadClubs, getPlayerCount } = await import("./db/loader.js");
    const { readPlayerCache, writePlayerCache } = await import("./db/cache.js");

    // Loading the full graph dataset is ~40 paginated round-trips to Neon, so
    // cache it locally. One cheap COUNT query tells us whether the importer has
    // changed the data since the cache was written.
    const count = await getPlayerCount();
    const cached = readPlayerCache(count);
    if (cached) {
      players = cached;
      clubsById = await loadClubs();
      console.log(`Loaded ${players.length} players from local cache, ${clubsById.size} clubs from DB`);
    } else {
      console.log("Loading players from Neon DB...");
      players = await loadPlayersFromDb();
      clubsById = await loadClubs();
      console.log(`Loaded ${players.length} players, ${clubsById.size} clubs from DB`);
      writePlayerCache(players, count);
      console.log("Wrote local player cache");
    }

    // Search runs in Postgres against the full dataset (trigram-ranked, ordered
    // by popularity); the graph still needs every player in memory for BFS.
    const { ensureSearchIndex } = await import("./db/search-schema.js");
    const { DbPlayerSearchService } = await import("./services/db-player-search.js");
    await ensureSearchIndex();
    searchService = new DbPlayerSearchService();
  } else {
    const { players: hardcodedPlayers } = await import("./data/index.js");
    console.log("DATABASE_URL not set — using hardcoded player data");
    players = hardcodedPlayers;
    searchService = new InMemoryPlayerSearchService(players);
  }

  graph = buildGraph(players);
  playerLookup = new Map(players.map((p) => [p.id, p]));

  const playerCount = players.length;

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", playerCount });
  });

  app.use("/api", createSeparationRouter(graph, playerLookup, searchService, clubsById));
  app.use("/api", createPlayersRouter(searchService, playerLookup, clubsById));
  app.use("/api", createClubsRouter(graph, playerLookup, clubsById));

  app.get("/{*splat}", (_req, res) => {
    res.sendFile(path.join(frontendDist, "index.html"));
  });
}
