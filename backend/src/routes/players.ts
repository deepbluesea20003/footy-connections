import { Router } from "express";
import { PlayerSearchService } from "../services/player-search.js";
import { commonsThumbUrl } from "../utils/image.js";

export function createPlayersRouter(searchService: PlayerSearchService): Router {
  const router = Router();

  router.get("/players/search", (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    if (q.length < 1) {
      res.json({ players: [] });
      return;
    }

    const results = searchService.search(q, 10);
    res.json({
      players: results.map((p) => ({
        id: p.id,
        name: p.name,
        dateOfBirth: p.dateOfBirth ?? null,
        nationality: p.nationality ?? null,
        imageUrl: p.imageFile ? commonsThumbUrl(p.imageFile) : null,
        popularity: p.popularity ?? null,
        clubs: [...new Set(p.clubs.map((c) => c.club))],
      })),
    });
  });

  return router;
}
