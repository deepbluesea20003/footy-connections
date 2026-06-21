import { Router } from "express";
import type { Response } from "express";
import { z } from "zod";
import type { PlayerSearchService } from "../services/player-search.js";
import { findShortestPath, bfsExplore } from "../graph/bfs.js";
import type { BipartiteGraph, PathStep } from "../types/graph.js";
import type { Player } from "../types/player.js";
import type { ClubInfo } from "../db/loader.js";
import { commonsThumbUrl } from "../utils/image.js";
import { playerSummary } from "../services/player-view.js";

// How many faces to show per connecting club (most-notable first).
const SQUAD_CAP = 16;

const SeparationRequest = z.object({
  player1: z.string().min(1).max(100).trim(),
  player2: z.string().min(1).max(100).trim(),
});

export function createSeparationRouter(
  graph: BipartiteGraph,
  playerLookup: Map<string, Player>,
  searchService: PlayerSearchService,
  clubsById: Map<string, ClubInfo>
): Router {
  const router = Router();

  // The frontend sends the canonical player id chosen in the autocomplete, so a
  // disambiguated pick (e.g. the right "Pelé") is honored exactly. Fall back to
  // fuzzy name resolution for typed-in queries / the public API.
  const resolveQuery = (q: string) => {
    const direct = playerLookup.get(q);
    if (direct) return Promise.resolve({ type: "found" as const, player: direct });
    return searchService.resolve(q);
  };

  // Validate + resolve both queries, writing the appropriate error response and
  // returning null on failure. Shared by /separation and /separation/explore.
  async function resolvePair(req: unknown, res: Response): Promise<[Player, Player] | null> {
    const parsed = SeparationRequest.safeParse(req);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
      return null;
    }
    const { player1: q1, player2: q2 } = parsed.data;
    const [r1, r2] = await Promise.all([resolveQuery(q1), resolveQuery(q2)]);

    for (const [r, q] of [[r1, q1], [r2, q2]] as const) {
      if (!r) {
        res.status(404).json({ error: "player_not_found", details: `No player found matching "${q}"` });
        return null;
      }
      if (r.type === "ambiguous") {
        res.status(400).json({
          error: "ambiguous_player",
          details: `Multiple players match "${q}"`,
          suggestions: r.players.map((p) => ({ id: p.id, name: p.name, dateOfBirth: p.dateOfBirth ?? null })),
        });
        return null;
      }
    }
    return [(r1 as { player: Player }).player, (r2 as { player: Player }).player];
  }

  // Attach photos + crests the UI needs but the graph doesn't hold, from the
  // in-memory player/club maps (no DB round-trip).
  const decoratePath = (path: PathStep[]): PathStep[] =>
    path.map((step) => ({
      ...step,
      playerImageUrl: playerLookup.get(step.playerId)?.imageFile
        ? commonsThumbUrl(playerLookup.get(step.playerId)!.imageFile!)
        : null,
      clubCrestUrl: (step.clubId ? clubsById.get(step.clubId)?.crestUrl : undefined) ?? null,
    }));

  router.post("/separation", async (req, res) => {
    const pair = await resolvePair(req.body, res);
    if (!pair) return;

    const result = findShortestPath(graph, pair[0].id, pair[1].id, playerLookup);
    if (!result) {
      res.status(404).json({ error: "player_not_found", details: "Player not in graph" });
      return;
    }
    result.path = decoratePath(result.path);
    res.json(result);
  });

  // Player-centric view of the connection for the graph viz: the path players
  // (faces) linked through the squads they actually shared. Kept separate from
  // /separation so the default flow stays lightweight.
  router.post("/separation/explore", async (req, res) => {
    const pair = await resolvePair(req.body, res);
    if (!pair) return;

    const result = bfsExplore(graph, pair[0].id, pair[1].id, playerLookup);
    const path = decoratePath(result.path);

    // For each link in the path, the shared club-season and its squad (the
    // teammates "via which they connect") — the faces grouped under each club.
    const connectors = [];
    for (let i = 1; i < path.length; i++) {
      const step = path[i];
      const node = graph.clubSeasonIndex.get(`${step.clubId ?? step.club}::${step.season}`);
      if (!node) continue;
      const squad = node.roster
        .map((id) => playerLookup.get(id))
        .filter((p): p is Player => !!p)
        .map(playerSummary)
        .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
        .slice(0, SQUAD_CAP);
      connectors.push({
        key: `${step.clubId ?? step.club}::${step.season}`,
        club: step.club,
        clubId: step.clubId ?? null,
        season: step.season,
        crestUrl: (step.clubId ? clubsById.get(step.clubId)?.crestUrl : undefined) ?? null,
        fromPlayerId: path[i - 1].playerId,
        toPlayerId: step.playerId,
        squad,
      });
    }

    res.json({
      found: result.found,
      separationNumber: result.separationNumber,
      path,
      connectors,
      totals: result.totals,
      layers: result.layers,
    });
  });

  return router;
}
