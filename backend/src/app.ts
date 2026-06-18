import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";
import type { Player } from "./types/player.js";
import type { AdjacencyList } from "./types/graph.js";
import { buildGraph } from "./graph/build.js";
import { PlayerSearchService } from "./services/player-search.js";
import { createSeparationRouter } from "./routes/separation.js";
import { createPlayersRouter } from "./routes/players.js";

export const app = express();
app.use(cors());
app.use(express.json());

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDist = path.join(__dirname, "../../frontend/dist");
app.use(express.static(frontendDist));

export let graph: AdjacencyList = new Map();
export let playerLookup: Map<string, Player> = new Map();
export let searchService: PlayerSearchService = new PlayerSearchService([]);

let initialized = false;

export async function initApp(): Promise<void> {
  if (initialized) return;
  initialized = true;

  let players: Player[];

  if (process.env.DATABASE_URL) {
    const { loadPlayersFromDb } = await import("./db/loader.js");
    console.log("Loading players from Neon DB...");
    players = await loadPlayersFromDb();
    console.log(`Loaded ${players.length} players from DB`);
  } else {
    const { players: hardcodedPlayers } = await import("./data/index.js");
    console.log("DATABASE_URL not set — using hardcoded player data");
    players = hardcodedPlayers;
  }

  graph = buildGraph(players);
  playerLookup = new Map(players.map((p) => [p.id, p]));
  searchService = new PlayerSearchService(players);

  const playerCount = players.length;

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", playerCount });
  });

  app.use("/api", createSeparationRouter(graph, playerLookup, searchService));
  app.use("/api", createPlayersRouter(searchService));

  app.get("/{*splat}", (_req, res) => {
    res.sendFile(path.join(frontendDist, "index.html"));
  });
}
