import type { BipartiteGraph } from "../types/graph.js";
import type { Player } from "../types/player.js";
import type { ClubInfo } from "../db/loader.js";
import { findShortestPath } from "../graph/bfs.js";
import { playerSummary } from "./player-view.js";
import { LEAGUES, CURATED_LEAGUE_IDS, competitionName, type League } from "../data/competitions.js";

export type Difficulty = "easy" | "medium" | "hard";

// Endpoint fame floors on `popularity` (= ln(1+market value), ~0–19). Easy uses
// only global stars; hard reaches into well-known-to-fans territory so the path
// (and its middle players) can get trickier.
const FLOORS: Record<Difficulty, number> = { easy: 17, medium: 15.5, hard: 13.5 };
// How deep BFS explores when searching for the second endpoint.
const MAX_DEPTH: Record<Difficulty, number> = { easy: 3, medium: 5, hard: 9 };
// Preferred separation (par) per difficulty, best-match-first.
const DEPTH_PREF: Record<Difficulty, number[]> = {
  easy: [2, 3],
  medium: [3, 4, 2, 5],
  hard: [7, 6, 5, 8, 9, 4, 3],
};

export interface PuzzleResult {
  player1: ReturnType<typeof playerSummary>;
  player2: ReturnType<typeof playerSummary>;
  par: number;
}

export interface SharedLink {
  club: string;
  clubId: string | null;
  crestUrl: string | null;
  season: string;
  date: string | null;
  competition: string | null;
  gamesTogether: number;
}

export interface GuessResult {
  connected: boolean;
  links: SharedLink[];
}

export interface HintResult {
  found: boolean;
  /** The next connecting club on a shortest path from the user's position. */
  club?: string;
  clubId?: string | null;
  crestUrl?: string | null;
  season?: string;
  competition?: string | null;
  /** True when this next link reaches the target directly (no hidden player). */
  isFinal?: boolean;
  /** Obfuscated teaser for the next player needed (omitted when isFinal). */
  player?: { initial: string; nationality: string | null } | null;
}

// --- deterministic RNG (for the daily challenge) -------------------------
function xfnv1a(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}
function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function rngFrom(seed?: string): () => number {
  return seed ? mulberry32(xfnv1a(seed)) : Math.random;
}

interface Cand {
  id: string;
  pop: number;
}

/** Weighted pick biased toward more-famous entries; `rng` makes it seedable. */
function weightedPick<T extends Cand>(arr: T[], rng: () => number): T {
  let total = 0;
  for (const c of arr) total += Math.max(0.1, c.pop);
  let r = rng() * total;
  for (const c of arr) {
    r -= Math.max(0.1, c.pop);
    if (r <= 0) return c;
  }
  return arr[arr.length - 1];
}

export interface GameService {
  generatePuzzle(opts: { difficulty: Difficulty; leagues?: string[]; seed?: string }): PuzzleResult | null;
  linkBetween(fromId: string, toId: string): GuessResult;
  hintFor(fromId: string, toId: string): HintResult;
  solve(fromId: string, toId: string): ReturnType<typeof findShortestPath>;
  listLeagues(): League[];
}

export function createGameService(deps: {
  graph: BipartiteGraph;
  playerLookup: Map<string, Player>;
  clubsById: Map<string, ClubInfo>;
}): GameService {
  const { graph, playerLookup, clubsById } = deps;

  // Fame pool: everyone clearing the lowest endpoint floor, sorted famous-first
  // (id-tiebroken so seeded picks are stable across boots).
  const famousPool: Cand[] = [];
  for (const p of playerLookup.values()) {
    const pop = p.popularity ?? 0;
    if (pop >= FLOORS.hard && (graph.playerToSeasons.get(p.id)?.length ?? 0) > 0) {
      famousPool.push({ id: p.id, pop });
    }
  }
  famousPool.sort((a, b) => b.pop - a.pop || (a.id < b.id ? -1 : 1));

  // League index, curated leagues only (bounded memory — see boot-OOM note).
  const leaguePlayers = new Map<string, Set<string>>();
  for (const id of CURATED_LEAGUE_IDS) leaguePlayers.set(id, new Set());
  for (const node of graph.clubSeasonIndex.values()) {
    const set = node.competition ? leaguePlayers.get(node.competition) : undefined;
    if (!set) continue;
    for (const id of node.roster) set.add(id);
  }

  function unionLeagueSet(leagues?: string[]): Set<string> | undefined {
    const valid = (leagues ?? []).filter((id) => (leaguePlayers.get(id)?.size ?? 0) > 0);
    if (!valid.length) return undefined;
    if (valid.length === 1) return leaguePlayers.get(valid[0]);
    const u = new Set<string>();
    for (const id of valid) for (const pid of leaguePlayers.get(id)!) u.add(pid);
    return u;
  }

  // Depth-bounded BFS from `startId`; returns famous-enough candidates (depth ≥ 2)
  // meeting the floor + optional league filter, with their separation depth.
  function collectCandidates(
    startId: string,
    maxDepth: number,
    floor: number,
    leagueSet?: Set<string>
  ): { id: string; depth: number; pop: number }[] {
    const { playerToSeasons } = graph;
    if (!playerToSeasons.has(startId)) return [];
    const visited = new Set<string>([startId]);
    const depthMap = new Map<string, number>([[startId, 0]]);
    const queue: string[] = [startId];
    let head = 0;
    const out: { id: string; depth: number; pop: number }[] = [];

    while (head < queue.length) {
      const cur = queue[head++];
      const d = depthMap.get(cur)!;
      if (d >= maxDepth) continue;
      for (const node of playerToSeasons.get(cur)!) {
        for (const tid of node.roster) {
          if (visited.has(tid)) continue;
          visited.add(tid);
          const nd = d + 1;
          depthMap.set(tid, nd);
          queue.push(tid);
          if (nd < 2) continue;
          if (leagueSet && !leagueSet.has(tid)) continue;
          const p = playerLookup.get(tid);
          const pop = p?.popularity ?? 0;
          if (p && pop >= floor) out.push({ id: tid, depth: nd, pop });
        }
      }
    }
    return out;
  }

  function pickSecond(
    cands: { id: string; depth: number; pop: number }[],
    difficulty: Difficulty,
    rng: () => number
  ): { id: string; depth: number } | null {
    if (!cands.length) return null;
    const byDepth = new Map<number, Cand[]>();
    for (const c of cands) {
      let b = byDepth.get(c.depth);
      if (!b) byDepth.set(c.depth, (b = []));
      b.push({ id: c.id, pop: c.pop });
    }
    // Deterministic order within a bucket so seeded picks are reproducible.
    for (const b of byDepth.values()) b.sort((a, z) => (a.id < z.id ? -1 : 1));
    for (const d of DEPTH_PREF[difficulty]) {
      const bucket = byDepth.get(d);
      if (bucket?.length) return { id: weightedPick(bucket, rng).id, depth: d };
    }
    // No preferred depth available — take the deepest bucket we found.
    const depths = [...byDepth.keys()].sort((a, b) => b - a);
    const bucket = byDepth.get(depths[0])!;
    return { id: weightedPick(bucket, rng).id, depth: depths[0] };
  }

  function generatePuzzle(opts: { difficulty: Difficulty; leagues?: string[]; seed?: string }): PuzzleResult | null {
    const { difficulty } = opts;
    const floor = FLOORS[difficulty];
    const rng = rngFrom(opts.seed ? `${opts.seed}:${difficulty}` : undefined);
    const leagueSet = unionLeagueSet(opts.leagues);

    const p1pool = famousPool.filter((p) => p.pop >= floor && (!leagueSet || leagueSet.has(p.id)));
    if (!p1pool.length) {
      // League too thin for this fame floor — drop the league constraint.
      if (leagueSet) return generatePuzzle({ ...opts, leagues: undefined });
      return null;
    }

    const ATTEMPTS = 8;
    for (let i = 0; i < ATTEMPTS; i++) {
      const player1 = weightedPick(p1pool, rng);
      const cands = collectCandidates(player1.id, MAX_DEPTH[difficulty], floor, leagueSet);
      const second = pickSecond(cands, difficulty, rng);
      if (second && second.id !== player1.id) {
        const p1 = playerLookup.get(player1.id)!;
        const p2 = playerLookup.get(second.id)!;
        return { player1: playerSummary(p1), player2: playerSummary(p2), par: second.depth };
      }
    }
    // Last resort: keep player1 in-league but let player2 be anyone famous enough.
    if (leagueSet) return generatePuzzle({ ...opts, leagues: undefined });
    return null;
  }

  function linkBetween(fromId: string, toId: string): GuessResult {
    const nodes = graph.playerToSeasons.get(fromId);
    if (!nodes || fromId === toId) return { connected: false, links: [] };

    const agg = new Map<string, { club: string; clubId: string | null; season: string; date: string | null; competition?: string; count: number }>();
    for (const node of nodes) {
      if (!node.roster.includes(toId)) continue;
      const key = `${node.clubId ?? node.club}::${node.season}`;
      let a = agg.get(key);
      if (!a) {
        a = { club: node.club, clubId: node.clubId ?? null, season: node.season, date: node.date ?? null, competition: node.competition, count: 0 };
        agg.set(key, a);
      }
      a.count++;
      if (node.date && (!a.date || node.date < a.date)) a.date = node.date; // earliest together
    }

    const links: SharedLink[] = [...agg.values()]
      .sort((a, b) => b.season.localeCompare(a.season) || b.count - a.count)
      .slice(0, 6)
      .map((a) => ({
        club: a.club,
        clubId: a.clubId,
        crestUrl: (a.clubId ? clubsById.get(a.clubId)?.crestUrl : undefined) ?? null,
        season: a.season,
        date: a.date,
        competition: competitionName(a.competition) ?? null,
        gamesTogether: a.count,
      }));

    return { connected: links.length > 0, links };
  }

  function hintFor(fromId: string, toId: string): HintResult {
    const res = findShortestPath(graph, fromId, toId, playerLookup);
    if (!res || !res.found || res.path.length < 2) return { found: false };
    const next = res.path[1];
    const isFinal = next.playerId === toId;
    const node = next.gameId ? graph.clubSeasonIndex.get(`${next.gameId}::${next.clubId ?? next.club}`) : undefined;
    const p = playerLookup.get(next.playerId);
    return {
      found: true,
      club: next.club,
      clubId: next.clubId ?? null,
      crestUrl: (next.clubId ? clubsById.get(next.clubId)?.crestUrl : undefined) ?? null,
      season: next.season,
      competition: competitionName(node?.competition) ?? null,
      isFinal,
      player: isFinal || !p ? null : { initial: p.name.charAt(0).toUpperCase(), nationality: p.nationality ?? null },
    };
  }

  function solve(fromId: string, toId: string) {
    return findShortestPath(graph, fromId, toId, playerLookup);
  }

  function listLeagues(): League[] {
    return LEAGUES.filter((l) => (leaguePlayers.get(l.id)?.size ?? 0) > 0);
  }

  return { generatePuzzle, linkBetween, hintFor, solve, listLeagues };
}
