import { Router } from "express";
import type { BipartiteGraph } from "../types/graph.js";
import type { Player } from "../types/player.js";
import type { ClubInfo } from "../db/loader.js";
import { playerSummary } from "../services/player-view.js";
import { wikidataUrl } from "../utils/wiki.js";

export function createClubsRouter(
  graph: BipartiteGraph,
  playerLookup: Map<string, Player>,
  clubsById: Map<string, ClubInfo>
): Router {
  const router = Router();

  // The full roster of a club for one season — backs the "View squad" modal.
  router.get("/clubs/:clubId/squad", (req, res) => {
    const { clubId } = req.params;
    const season = typeof req.query.season === "string" ? req.query.season : "";
    if (!season) {
      res.status(400).json({ error: "season_required" });
      return;
    }

    const node = graph.clubSeasonIndex.get(`${clubId}::${season}`);
    if (!node) {
      res.status(404).json({ error: "squad_not_found" });
      return;
    }

    const info = clubsById.get(clubId);
    const players = node.roster
      .map((id) => playerLookup.get(id))
      .filter((p): p is Player => !!p)
      .map(playerSummary)
      .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));

    res.json({
      club: {
        id: clubId,
        name: info?.name ?? node.club,
        crestUrl: info?.crestUrl ?? null,
        wikidataUrl: wikidataUrl(clubId),
      },
      season,
      players,
    });
  });

  return router;
}
