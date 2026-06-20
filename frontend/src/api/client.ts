import type { PlayerSuggestion, SeparationResult, PlayerDetail, SquadResponse } from "../types";

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
