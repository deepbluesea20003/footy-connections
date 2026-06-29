import type {
  PlayerSuggestion,
  SeparationResult,
  PlayerDetail,
  SquadResponse,
  ExploreResult,
  Difficulty,
  GameLeague,
  GameSquad,
  Puzzle,
  GuessResult,
  HintResult,
} from "../types";

const BASE = "/api";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.details || body.error || res.statusText);
  }
  return res.json();
}

export function searchPlayers(
  query: string,
  signal?: AbortSignal
): Promise<{ players: PlayerSuggestion[] }> {
  return request(`/players/search?q=${encodeURIComponent(query)}`, { signal });
}

export function findSeparation(
  player1: string,
  player2: string
): Promise<SeparationResult> {
  return request("/separation", {
    method: "POST",
    body: JSON.stringify({ player1, player2 }),
  });
}

export function exploreSeparation(
  player1: string,
  player2: string,
  signal?: AbortSignal
): Promise<ExploreResult> {
  return request("/separation/explore", {
    method: "POST",
    body: JSON.stringify({ player1, player2 }),
    signal,
  });
}

export function getPlayer(id: string, signal?: AbortSignal): Promise<PlayerDetail> {
  return request(`/players/${encodeURIComponent(id)}`, { signal });
}

export function getSquad(
  clubId: string,
  season: string,
  signal?: AbortSignal
): Promise<SquadResponse> {
  return request(`/clubs/${encodeURIComponent(clubId)}/squad?season=${encodeURIComponent(season)}`, { signal });
}

// --- Game ----------------------------------------------------------------

export function getLeagues(signal?: AbortSignal): Promise<{ leagues: GameLeague[] }> {
  return request("/game/leagues", { signal });
}

export function newGame(opts: {
  difficulty?: Difficulty;
  leagues?: string[];
  mode?: "random" | "daily";
}): Promise<Puzzle> {
  return request("/game/new", { method: "POST", body: JSON.stringify(opts) });
}

export function guessLink(
  from: string,
  to: string,
  via?: { clubId?: string; season?: string }
): Promise<GuessResult> {
  return request("/game/guess", { method: "POST", body: JSON.stringify({ from, to, via }) });
}

export function getHint(from: string, to: string): Promise<HintResult> {
  return request("/game/hint", { method: "POST", body: JSON.stringify({ from, to }) });
}

/** A club-season squad: the next-pick pool when expanding a player in the game. */
export function getGameSquad(
  clubId: string,
  season: string,
  signal?: AbortSignal
): Promise<GameSquad> {
  return request(
    `/game/squad?clubId=${encodeURIComponent(clubId)}&season=${encodeURIComponent(season)}`,
    { signal }
  );
}

/** A shortest season-level solution path, for "give up" reveals. */
export function getGameSolution(player1: string, player2: string): Promise<SeparationResult> {
  return request("/game/solution", {
    method: "POST",
    body: JSON.stringify({ player1, player2 }),
  });
}
