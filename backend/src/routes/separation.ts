import { Router } from "express";
import { z } from "zod";
import { PlayerSearchService } from "../services/player-search.js";
import { findShortestPath } from "../graph/bfs.js";
import type { BipartiteGraph } from "../types/graph.js";
import type { Player } from "../types/player.js";

const SeparationRequest = z.object({
  player1: z.string().min(1).max(100).trim(),
  player2: z.string().min(1).max(100).trim(),
});

export function createSeparationRouter(
  graph: BipartiteGraph,
  playerLookup: Map<string, Player>,
  searchService: PlayerSearchService
): Router {
  const router = Router();

  router.post("/separation", (req, res) => {
    const parsed = SeparationRequest.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
      return;
    }

    const { player1: q1, player2: q2 } = parsed.data;

    const r1 = searchService.resolve(q1);
    const r2 = searchService.resolve(q2);

    if (!r1) {
      res.status(404).json({ error: "player_not_found", details: `No player found matching "${q1}"` });
      return;
    }
    if (!r2) {
      res.status(404).json({ error: "player_not_found", details: `No player found matching "${q2}"` });
      return;
    }
    if (r1.type === "ambiguous") {
      res.status(400).json({
        error: "ambiguous_player",
        details: `Multiple players match "${q1}"`,
        suggestions: r1.players.map((p) => ({ id: p.id, name: p.name, dateOfBirth: p.dateOfBirth ?? null })),
      });
      return;
    }
    if (r2.type === "ambiguous") {
      res.status(400).json({
        error: "ambiguous_player",
        details: `Multiple players match "${q2}"`,
        suggestions: r2.players.map((p) => ({ id: p.id, name: p.name, dateOfBirth: p.dateOfBirth ?? null })),
      });
      return;
    }

    const result = findShortestPath(graph, r1.player.id, r2.player.id, playerLookup);
    if (!result) {
      res.status(404).json({ error: "player_not_found", details: "Player not in graph" });
      return;
    }

    res.json(result);
  });

  return router;
}
