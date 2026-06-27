import { Router } from "express";
import { z } from "zod";
import type { GameService } from "../services/game.js";
import type { Player } from "../types/player.js";
import type { ClubInfo } from "../db/loader.js";
import type { PathStep } from "../types/graph.js";

const Difficulty = z.enum(["easy", "medium", "hard"]);

const NewRequest = z.object({
  difficulty: Difficulty.default("medium"),
  leagues: z.array(z.string().max(20)).max(40).optional(),
  mode: z.enum(["random", "daily"]).optional(),
});

const PairRequest = z.object({
  from: z.string().min(1).max(120),
  to: z.string().min(1).max(120),
});

const SolutionRequest = z.object({
  player1: z.string().min(1).max(120),
  player2: z.string().min(1).max(120),
});

// Day index for the daily challenge — days since launch, UTC.
const DAILY_EPOCH = Date.UTC(2026, 5, 1); // 2026-06-01
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}
function dailyNumber(): number {
  const today = Date.parse(todayUtc()); // ISO date string parses as UTC midnight
  return Math.floor((today - DAILY_EPOCH) / 86_400_000) + 1;
}

export function createGameRouter(
  game: GameService,
  playerLookup: Map<string, Player>,
  clubsById: Map<string, ClubInfo>
): Router {
  const router = Router();

  const decoratePath = (path: PathStep[]): PathStep[] =>
    path.map((step) => ({
      ...step,
      playerImageUrl: playerLookup.get(step.playerId)?.imageUrl ?? null,
      clubCrestUrl: (step.clubId ? clubsById.get(step.clubId)?.crestUrl : undefined) ?? null,
    }));

  router.get("/game/leagues", (_req, res) => {
    res.json({ leagues: game.listLeagues() });
  });

  router.post("/game/new", (req, res) => {
    const parsed = NewRequest.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
      return;
    }
    const daily = parsed.data.mode === "daily";
    const difficulty = daily ? "medium" : parsed.data.difficulty;
    const seed = daily ? `daily:${todayUtc()}` : undefined;

    const puzzle = game.generatePuzzle({ difficulty, leagues: daily ? undefined : parsed.data.leagues, seed });
    if (!puzzle) {
      res.status(503).json({ error: "puzzle_unavailable", details: "Could not build a puzzle — try a different difficulty or fewer leagues." });
      return;
    }
    res.json({
      puzzleId: seed ?? `${puzzle.player1.id}|${puzzle.player2.id}`,
      difficulty,
      ...puzzle,
      ...(daily ? { daily: true, dailyNumber: dailyNumber() } : {}),
    });
  });

  router.post("/game/guess", (req, res) => {
    const parsed = PairRequest.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
      return;
    }
    res.json(game.linkBetween(parsed.data.from, parsed.data.to));
  });

  router.post("/game/hint", (req, res) => {
    const parsed = PairRequest.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
      return;
    }
    res.json(game.hintFor(parsed.data.from, parsed.data.to));
  });

  router.post("/game/solution", (req, res) => {
    const parsed = SolutionRequest.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
      return;
    }
    const result = game.solve(parsed.data.player1, parsed.data.player2);
    if (!result) {
      res.status(404).json({ error: "player_not_found", details: "Player not in graph" });
      return;
    }
    res.json({ ...result, path: decoratePath(result.path) });
  });

  return router;
}
