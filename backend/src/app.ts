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
    const { loadGraph, loadClubs } = await import("./db/loader.js");

    // Build the co-appearance graph in one streaming pass from game_lineups.
    const ds = await loadGraph();
    players = ds.players;
    graph = ds.graph;
    clubsById = await loadClubs();
    console.log(`Loaded ${players.length} players, ${clubsById.size} clubs from DB`);

    // Search runs in Postgres (trigram-ranked, ordered by market-value popularity).
    const { ensureSearchIndex } = await import("./db/search-schema.js");
    const { DbPlayerSearchService } = await import("./services/db-player-search.js");
    await ensureSearchIndex();
    searchService = new DbPlayerSearchService();
  } else {
    const { players: hardcodedPlayers } = await import("./data/index.js");
    console.log("DATABASE_URL not set — using hardcoded player data");
    players = hardcodedPlayers;
    graph = buildGraph(players);
    searchService = new InMemoryPlayerSearchService(players);
  }

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
