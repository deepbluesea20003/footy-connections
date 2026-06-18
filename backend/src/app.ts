import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";
import { players, playerLookup } from "./data/index.js";
import { buildGraph } from "./graph/build.js";
import { PlayerSearchService } from "./services/player-search.js";
import { createSeparationRouter } from "./routes/separation.js";
import { createPlayersRouter } from "./routes/players.js";

const graph = buildGraph(players);
const searchService = new PlayerSearchService(players);

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", playerCount: players.length });
});

app.use("/api", createSeparationRouter(graph, playerLookup, searchService));
app.use("/api", createPlayersRouter(searchService));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDist = path.join(__dirname, "../../frontend/dist");
app.use(express.static(frontendDist));
app.get("/{*splat}", (_req, res) => {
  res.sendFile(path.join(frontendDist, "index.html"));
});

export { app, graph, playerLookup, searchService };
