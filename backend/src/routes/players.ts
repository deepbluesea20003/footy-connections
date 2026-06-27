import { Router } from "express";
import type { PlayerSearchService } from "../services/player-search.js";
import type { Player } from "../types/player.js";
import type { ClubInfo } from "../db/loader.js";
import { playerDetail } from "../services/player-view.js";

export function createPlayersRouter(
  searchService: PlayerSearchService,
  playerLookup: Map<string, Player>,
  clubsById: Map<string, ClubInfo>
): Router {
  const router = Router();

  router.get("/players/search", async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    if (q.length < 1) {
      res.json({ players: [] });
      return;
    }

    const results = await searchService.search(q, 10);
    res.json({
      players: results.map((p) => ({
        id: p.id,
        name: p.name,
        dateOfBirth: p.dateOfBirth ?? null,
        nationality: p.nationality ?? null,
        imageUrl: p.imageUrl ?? null,
        popularity: p.popularity ?? null,
        clubs: [...new Set(p.clubs.map((c) => c.club))],
      })),
    });
  });

  // Full detail for the selected-player card: photo, career timeline, links.
  router.get("/players/:id", (req, res) => {
    const player = playerLookup.get(req.params.id);
    if (!player) {
      res.status(404).json({ error: "player_not_found" });
      return;
    }
    res.json(playerDetail(player, clubsById));
  });

  return router;
}
