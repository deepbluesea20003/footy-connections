import type { BipartiteGraph, PathStep, SeparationResult } from "../types/graph.js";
import type { Player } from "../types/player.js";
import type { ClubInfo } from "../db/loader.js";
import { playerSummary } from "./player-view.js";
import { LEAGUES, CURATED_LEAGUE_IDS, competitionName, type League } from "../data/competitions.js";

export type Difficulty = "easy" | "medium" | "hard";

// Endpoint fame floors on `popularity` (= ln(1+market value), ~0–19). Tuned
// against the live distribution so both endpoints are recognisable names:
// easy ≈ household stars (Rooney/Morata tier, ~18), medium ≈ clearly famous
// (Dalot/Matip tier, ~17.3), hard ≈ known-to-fans (~16). Below ~16 the pool is
// mostly journeymen/squad fillers, which made puzzles feel obscure.
const FLOORS: Record<Difficulty, number> = { easy: 18, medium: 17.3, hard: 16 };
// How deep the season-level BFS explores when searching for the second endpoint.
const MAX_DEPTH: Record<Difficulty, number> = { easy: 3, medium: 5, hard: 8 };
// Preferred separation (par) per difficulty, best-match-first.
const DEPTH_PREF: Record<Difficulty, number[]> = {
  easy: [2, 3],
  medium: [3, 4, 2, 5],
  hard: [6, 5, 7, 4, 8, 3],
};

// Puzzle endpoints default to the five major European leagues so you connect
// recognisable players, not obscure ones. The connecting path can still route
// through any competition. Explicit league filters in settings override this.
const BIG5 = ["GB1", "ES1", "IT1", "L1", "FR1"];

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
  club?: string;
  clubId?: string | null;
  crestUrl?: string | null;
  season?: string;
  competition?: string | null;
  isFinal?: boolean;
  player?: { initial: string; nationality: string | null } | null;
}

export interface SquadResult {
  club: { id: string; name: string; crestUrl: string | null };
  season: string;
  competition: string | null;
  players: ReturnType<typeof playerSummary>[];
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

/** A club's whole-season squad — the unit the game connects through. Two players
 *  are "teammates" iff they share one of these (appeared for the same club in the
 *  same season), so every member shown in the squad picker is a valid pick. */
interface SeasonHub {
  clubId: string;
  club: string;
  season: string;
  competition?: string;
  players: string[];
}

interface SeasonParent {
  parentId: string | null;
  hubKey: string | null;
}

export interface GameService {
  generatePuzzle(opts: { difficulty: Difficulty; leagues?: string[]; seed?: string }): PuzzleResult | null;
  linkBetween(fromId: string, toId: string, via?: { clubId?: string; season?: string }): GuessResult;
  hintFor(fromId: string, toId: string): HintResult;
  solve(fromId: string, toId: string): SeparationResult | null;
  seasonSquad(clubId: string, season: string): SquadResult | null;
  listLeagues(): League[];
}

export function createGameService(deps: {
  graph: BipartiteGraph;
  playerLookup: Map<string, Player>;
  clubsById: Map<string, ClubInfo>;
}): GameService {
  const { graph, playerLookup, clubsById } = deps;

  // --- Build the season-level model from the game-level graph (once). ------
  const seasonHubs = new Map<string, SeasonHub>(); // `${clubId}::${season}` -> hub
  const playerHubs = new Map<string, string[]>(); // playerId -> hub keys (its career)
  {
    const rosterSets = new Map<string, Set<string>>();
    for (const node of graph.clubSeasonIndex.values()) {
      // Identity = club id when known (exact), else the display name — mirrors
      // buildGraph so seed/test data with no club ids still forms hubs.
      const cid = node.clubId ?? node.club;
      const key = `${cid}::${node.season}`;
      let hub = seasonHubs.get(key);
      if (!hub) {
        hub = { clubId: cid, club: node.club, season: node.season, competition: node.competition, players: [] };
        seasonHubs.set(key, hub);
        rosterSets.set(key, new Set());
      }
      // Prefer a known league name for the hub's competition label.
      if (!competitionName(hub.competition) && competitionName(node.competition)) hub.competition = node.competition;
      const set = rosterSets.get(key)!;
      for (const id of node.roster) set.add(id);
    }
    for (const [key, set] of rosterSets) {
      const hub = seasonHubs.get(key)!;
      hub.players = [...set];
      for (const id of set) {
        let arr = playerHubs.get(id);
        if (!arr) playerHubs.set(id, (arr = []));
        arr.push(key);
      }
    }
  }

  // Fame pool: everyone clearing the lowest endpoint floor, famous-first
  // (id-tiebroken so seeded picks are stable across boots).
  const famousPool: Cand[] = [];
  for (const p of playerLookup.values()) {
    const pop = p.popularity ?? 0;
    if (pop >= FLOORS.hard && (playerHubs.get(p.id)?.length ?? 0) > 0) famousPool.push({ id: p.id, pop });
  }
  famousPool.sort((a, b) => b.pop - a.pop || (a.id < b.id ? -1 : 1));

  // League index, curated leagues only (bounded memory — see boot-OOM note).
  const leaguePlayers = new Map<string, Set<string>>();
  for (const id of CURATED_LEAGUE_IDS) leaguePlayers.set(id, new Set());
  for (const hub of seasonHubs.values()) {
    const set = hub.competition ? leaguePlayers.get(hub.competition) : undefined;
    if (!set) continue;
    for (const id of hub.players) set.add(id);
  }

  function unionLeagueSet(leagues?: string[]): Set<string> | undefined {
    const valid = (leagues ?? []).filter((id) => (leaguePlayers.get(id)?.size ?? 0) > 0);
    if (!valid.length) return undefined;
    if (valid.length === 1) return leaguePlayers.get(valid[0]);
    const u = new Set<string>();
    for (const id of valid) for (const pid of leaguePlayers.get(id)!) u.add(pid);
    return u;
  }

  // Season-level BFS. Optionally early-exits at `endId`; otherwise explores to
  // `maxDepth`. Each player's neighbours are everyone who shared one of their
  // season squads.
  function bfsSeason(startId: string, opts: { endId?: string; maxDepth: number }) {
    const visited = new Set<string>([startId]);
    const depth = new Map<string, number>([[startId, 0]]);
    const parent = new Map<string, SeasonParent>([[startId, { parentId: null, hubKey: null }]]);
    const queue: string[] = [startId];
    let head = 0;
    let found = false;

    outer: while (head < queue.length) {
      const cur = queue[head++];
      const d = depth.get(cur)!;
      if (d >= opts.maxDepth) continue;
      for (const hubKey of playerHubs.get(cur) ?? []) {
        const hub = seasonHubs.get(hubKey)!;
        for (const tid of hub.players) {
          if (visited.has(tid)) continue;
          visited.add(tid);
          depth.set(tid, d + 1);
          parent.set(tid, { parentId: cur, hubKey });
          if (tid === opts.endId) {
            found = true;
            break outer;
          }
          queue.push(tid);
        }
      }
    }
    return { visited, depth, parent, found };
  }

  function reconstruct(parent: Map<string, SeasonParent>, startId: string, endId: string): PathStep[] {
    const path: PathStep[] = [];
    let cur: string | null = endId;
    while (cur) {
      const entry: SeasonParent = parent.get(cur)!;
      const player = playerLookup.get(cur)!;
      const hub = entry.hubKey ? seasonHubs.get(entry.hubKey) : undefined;
      path.push({
        player: player.name,
        playerId: player.id,
        gameId: null,
        club: hub?.club ?? "",
        clubId: hub?.clubId ?? null,
        season: hub?.season ?? "",
      });
      cur = entry.parentId;
    }
    return path.reverse();
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
    for (const b of byDepth.values()) b.sort((a, z) => (a.id < z.id ? -1 : 1));
    for (const d of DEPTH_PREF[difficulty]) {
      const bucket = byDepth.get(d);
      if (bucket?.length) return { id: weightedPick(bucket, rng).id, depth: d };
    }
    const depths = [...byDepth.keys()].sort((a, b) => b - a);
    const bucket = byDepth.get(depths[0])!;
    return { id: weightedPick(bucket, rng).id, depth: depths[0] };
  }

  function attempt(difficulty: Difficulty, leagueSet: Set<string> | undefined, rng: () => number): PuzzleResult | null {
    const floor = FLOORS[difficulty];
    const p1pool = famousPool.filter((p) => p.pop >= floor && (!leagueSet || leagueSet.has(p.id)));
    if (!p1pool.length) return null;

    for (let i = 0; i < 8; i++) {
      const player1 = weightedPick(p1pool, rng);
      const { depth } = bfsSeason(player1.id, { maxDepth: MAX_DEPTH[difficulty] });
      const cands: { id: string; depth: number; pop: number }[] = [];
      for (const [id, d] of depth) {
        if (d < 2 || id === player1.id) continue;
        if (leagueSet && !leagueSet.has(id)) continue;
        const p = playerLookup.get(id);
        const pop = p?.popularity ?? 0;
        if (p && pop >= floor) cands.push({ id, depth: d, pop });
      }
      const second = pickSecond(cands, difficulty, rng);
      if (second && second.id !== player1.id) {
        return {
          player1: playerSummary(playerLookup.get(player1.id)!),
          player2: playerSummary(playerLookup.get(second.id)!),
          par: second.depth,
        };
      }
    }
    return null;
  }

  function generatePuzzle(opts: { difficulty: Difficulty; leagues?: string[]; seed?: string }): PuzzleResult | null {
    const rng = rngFrom(opts.seed ? `${opts.seed}:${opts.difficulty}` : undefined);
    const chosen = opts.leagues && opts.leagues.length ? opts.leagues : null;
    // Endpoints are always confined to the big-5 European leagues (or the user's
    // chosen subset of them) so both players are top-league, recognisable names.
    const res = attempt(opts.difficulty, unionLeagueSet(chosen ?? BIG5), rng);
    if (res) return res;
    // Chosen leagues too thin at this fame floor → widen to the full big-5,
    // never leaving the top-5 (we don't fall back to obscure global players).
    return chosen ? attempt(opts.difficulty, unionLeagueSet(BIG5), rng) : null;
  }

  // Games two players actually shared in a specific club-season (for the fun
  // fact); 0 if they overlapped the season but never the same matchday squad.
  function gamesTogether(fromId: string, toId: string, clubId: string, season: string): { count: number; date: string | null } {
    let count = 0;
    let date: string | null = null;
    for (const node of graph.playerToSeasons.get(fromId) ?? []) {
      if ((node.clubId ?? node.club) !== clubId || node.season !== season) continue;
      if (!node.roster.includes(toId)) continue;
      count++;
      if (node.date && (!date || node.date < date)) date = node.date;
    }
    return { count, date };
  }

  function toLink(hub: SeasonHub, fromId: string, toId: string): SharedLink {
    const gt = gamesTogether(fromId, toId, hub.clubId, hub.season);
    return {
      club: hub.club,
      clubId: hub.clubId,
      crestUrl: clubsById.get(hub.clubId)?.crestUrl ?? null,
      season: hub.season,
      date: gt.date,
      competition: competitionName(hub.competition) ?? null,
      gamesTogether: gt.count,
    };
  }

  function linkBetween(fromId: string, toId: string, via?: { clubId?: string; season?: string }): GuessResult {
    if (fromId === toId || !playerHubs.has(fromId)) return { connected: false, links: [] };

    // Pinned to a specific club-season the user navigated through.
    if (via?.clubId && via?.season) {
      const hub = seasonHubs.get(`${via.clubId}::${via.season}`);
      if (hub && hub.players.includes(toId) && hub.players.includes(fromId)) {
        return { connected: true, links: [toLink(hub, fromId, toId)] };
      }
      return { connected: false, links: [] };
    }

    // Otherwise: any club-season they shared.
    const toHubs = new Set(playerHubs.get(toId) ?? []);
    const links: SharedLink[] = [];
    for (const key of playerHubs.get(fromId) ?? []) {
      if (!toHubs.has(key)) continue;
      links.push(toLink(seasonHubs.get(key)!, fromId, toId));
    }
    links.sort((a, b) => b.season.localeCompare(a.season) || b.gamesTogether - a.gamesTogether);
    return { connected: links.length > 0, links: links.slice(0, 6) };
  }

  function hintFor(fromId: string, toId: string): HintResult {
    if (!playerHubs.has(fromId) || !playerHubs.has(toId)) return { found: false };
    const { parent, found } = bfsSeason(fromId, { endId: toId, maxDepth: 20 });
    if (!found) return { found: false };
    const path = reconstruct(parent, fromId, toId);
    if (path.length < 2) return { found: false };
    const next = path[1];
    const isFinal = next.playerId === toId;
    const hub = next.clubId ? seasonHubs.get(`${next.clubId}::${next.season}`) : undefined;
    const p = playerLookup.get(next.playerId);
    return {
      found: true,
      club: next.club,
      clubId: next.clubId ?? null,
      crestUrl: (next.clubId ? clubsById.get(next.clubId)?.crestUrl : undefined) ?? null,
      season: next.season,
      competition: competitionName(hub?.competition) ?? null,
      isFinal,
      player: isFinal || !p ? null : { initial: p.name.charAt(0).toUpperCase(), nationality: p.nationality ?? null },
    };
  }

  function solve(fromId: string, toId: string): SeparationResult | null {
    if (!playerHubs.has(fromId) || !playerHubs.has(toId)) return null;
    if (fromId === toId) {
      const p = playerLookup.get(fromId)!;
      return { found: true, separationNumber: 0, path: [{ player: p.name, playerId: p.id, club: "", clubId: null, season: "" }] };
    }
    const { parent, found } = bfsSeason(fromId, { endId: toId, maxDepth: 20 });
    if (!found) return { found: false, separationNumber: -1, path: [] };
    const path = reconstruct(parent, fromId, toId);
    return { found: true, separationNumber: path.length - 1, path };
  }

  function seasonSquad(clubId: string, season: string): SquadResult | null {
    const hub = seasonHubs.get(`${clubId}::${season}`);
    if (!hub) return null;
    const players = hub.players
      .map((id) => playerLookup.get(id))
      .filter((p): p is Player => !!p)
      .map(playerSummary)
      .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
    return {
      club: { id: clubId, name: clubsById.get(clubId)?.name ?? hub.club, crestUrl: clubsById.get(clubId)?.crestUrl ?? null },
      season,
      competition: competitionName(hub.competition) ?? null,
      players,
    };
  }

  function listLeagues(): League[] {
    return LEAGUES.filter((l) => (leaguePlayers.get(l.id)?.size ?? 0) > 0);
  }

  return { generatePuzzle, linkBetween, hintFor, solve, seasonSquad, listLeagues };
}
