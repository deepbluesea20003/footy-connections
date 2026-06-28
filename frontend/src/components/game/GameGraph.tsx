import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import type { CareerStint, GamePlayer, Puzzle, SharedLink, SquadPlayer } from "../../types";
import { getPlayer, getGameSquad, guessLink } from "../../api/client";

// Theme hexes (canvas can't read CSS vars). Mirrors index.css tokens.
const C = {
  turf: "#15e081",
  turfSoft: "rgba(21,224,129,0.85)",
  electric: "#22d3ee",
  whistle: "#fbbf24",
  ink: "#060912",
  hub: "#0e1422",
  dim: "rgba(159,176,201,0.55)",
  faint: "rgba(148,163,184,0.18)",
  white: "#f4f7fb",
};

// Show the whole season squad (sorted famous-first) so any real connector is
// reachable; capped only to keep pathological rosters renderable.
const CANDIDATE_LIMIT = 40;

export interface ChainStep {
  player: { id: string; name: string; imageUrl?: string | null; nationality?: string | null };
  via: SharedLink | null; // connector to the previous step (null for the start)
}

interface HubInfo {
  clubId: string;
  club: string;
  season: string;
  crestUrl: string | null;
  competition: string | null;
}

interface Frontier {
  sourceId: string;
  hub: HubInfo;
  candidates: SquadPlayer[];
}

type Role = "start" | "chain" | "tip" | "goal" | "goalReady" | "candidate";

interface GNode {
  id: string;
  kind: "player" | "club";
  label: string;
  img?: string | null;
  role: Role;
  hub?: boolean; // committed connector vs frontier hub
  popularity?: number;
  season?: string;
  x?: number;
  y?: number;
  fx?: number;
  fy?: number;
}

interface GLink {
  source: string | { id: string };
  target: string | { id: string };
  onPath: boolean;
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

function hashColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return `hsl(${Math.abs(h) % 360} 55% 55%)`;
}

/** Draw `img` to fill a `d×d` box centred at (cx,cy), cropping to preserve aspect
 *  (CSS object-cover). `topBias` 0 keeps the top of the source — portraits put the
 *  face up high, so a low bias avoids the "squished" look the old square-stretch had. */
function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  cx: number,
  cy: number,
  d: number,
  topBias = 0.5
) {
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const s = Math.min(iw, ih);
  const sx = (iw - s) / 2;
  const sy = (ih - s) * topBias;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, sx, sy, s, s, cx - d / 2, cy - d / 2, d, d);
}

const radius = (n: GNode) => {
  if (n.kind === "club") return 13;
  if (n.role === "start" || n.role === "goal" || n.role === "goalReady" || n.role === "tip") return 18;
  if (n.role === "chain") return 16;
  return 11 + Math.min(5, (n.popularity ?? 0) * 0.4);
};

export interface GameStateOut {
  tipId: string;
  tipName: string;
  chainLength: number;
  won: boolean;
  steps: ChainStep[];
  canUndo: boolean;
  undo: () => void;
}

interface Props {
  puzzle: Puzzle;
  disabled: boolean;
  onState: (s: GameStateOut) => void;
}

export function GameGraph({ puzzle, disabled, onState }: Props) {
  const fgRef = useRef<any>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const imgCache = useRef<Map<string, HTMLImageElement>>(new Map());
  const careerCache = useRef<Map<string, CareerStint[]>>(new Map());
  const repaintPending = useRef(false);
  const hoverId = useRef<string | null>(null);
  // Auto-fit the camera only when content meaningfully changes (initial load, a
  // squad opening, a resize) — not on every physics settle, which felt jumpy.
  const pendingFit = useRef(true);
  const lastFrontierKey = useRef<string | null>(null);
  const [width, setWidth] = useState(800);

  const start: GamePlayer = puzzle.player1;
  const goal: GamePlayer = puzzle.player2;

  const [chain, setChain] = useState<ChainStep[]>([
    { player: { id: start.id, name: start.name, imageUrl: start.imageUrl, nationality: start.nationality }, via: null },
  ]);
  const [frontier, setFrontier] = useState<Frontier | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null); // playerId whose season menu is open
  const [career, setCareer] = useState<CareerStint[] | null>(null);
  const [loadingCareer, setLoadingCareer] = useState(false);
  const [loadingSeason, setLoadingSeason] = useState<string | null>(null);
  const [seasonNote, setSeasonNote] = useState<string | null>(null);

  const tip = chain[chain.length - 1].player;
  const won = tip.id === goal.id;
  const chainIds = useMemo(() => new Set(chain.map((c) => c.player.id)), [chain]);

  // Step back one pick, unselecting it (and clearing any open menu/frontier).
  const undo = useCallback(() => {
    setChain((c) => (c.length > 1 ? c.slice(0, -1) : c));
    setFrontier(null);
    setMenuFor(null);
    setCareer(null);
  }, []);

  // Bubble state up to GameTab (scoreboard / hint / result / undo control).
  useEffect(() => {
    onState({
      tipId: tip.id,
      tipName: tip.name,
      chainLength: chain.length - 1,
      won,
      steps: chain,
      canUndo: chain.length > 1,
      undo,
    });
  }, [chain, tip.id, tip.name, won, onState, undo]);

  // --- responsive width ---------------------------------------------------
  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((entries) => {
      pendingFit.current = true; // re-frame after the canvas resizes
      setWidth(entries[0].contentRect.width);
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const scheduleRepaint = useCallback(() => {
    if (repaintPending.current) return;
    repaintPending.current = true;
    requestAnimationFrame(() => {
      repaintPending.current = false;
      fgRef.current?.resumeAnimation?.();
    });
  }, []);

  const getImg = useCallback(
    (url: string): HTMLImageElement => {
      let img = imgCache.current.get(url);
      if (img) return img;
      img = new Image();
      img.onload = scheduleRepaint;
      img.src = url;
      imgCache.current.set(url, img);
      return img;
    },
    [scheduleRepaint]
  );

  // --- derive graph nodes/links from chain + frontier ---------------------
  // Reuse node objects across rebuilds so the force sim keeps their positions
  // (force-graph mutates x/y onto the objects); only new nodes animate in.
  const nodeCache = useRef<Map<string, GNode>>(new Map());
  const { nodes, links } = useMemo(() => {
    const cache = nodeCache.current;
    const nodes: GNode[] = [];
    const links: GLink[] = [];
    const seen = new Set<string>();
    const add = (spec: GNode) => {
      let n = cache.get(spec.id);
      if (!n) {
        n = spec;
        cache.set(spec.id, n);
      } else {
        n.kind = spec.kind;
        n.label = spec.label;
        n.img = spec.img;
        n.role = spec.role;
        n.hub = spec.hub;
        n.season = spec.season;
        n.popularity = spec.popularity;
      }
      if (!seen.has(n.id)) {
        seen.add(n.id);
        nodes.push(n);
      }
      return n;
    };

    // Committed chain: player — hub — player — hub — …
    chain.forEach((step, i) => {
      const isStart = i === 0;
      const isTip = i === chain.length - 1;
      const isGoal = step.player.id === goal.id;
      const role: Role = isStart ? "start" : isGoal ? "goal" : isTip ? "tip" : "chain";
      const pNode = add({
        id: step.player.id,
        kind: "player",
        label: step.player.name,
        img: step.player.imageUrl ?? null,
        role,
      });
      if (isStart) {
        pNode.fx = -width / 2 + 80;
        pNode.fy = 0;
      }
      if (step.via && step.via.clubId) {
        const hubId = `hub:${step.via.clubId}::${step.via.season}`;
        add({
          id: hubId,
          kind: "club",
          label: step.via.club,
          img: step.via.crestUrl,
          role: "chain",
          hub: true,
          season: step.via.season,
        });
        links.push({ source: chain[i - 1].player.id, target: hubId, onPath: true });
        links.push({ source: hubId, target: step.player.id, onPath: true });
      }
    });

    // Goal node (pinned right) if not yet reached.
    if (!chainIds.has(goal.id)) {
      const reachable = frontier?.candidates.some((c) => c.id === goal.id);
      const gNode = add({
        id: goal.id,
        kind: "player",
        label: goal.name,
        img: goal.imageUrl ?? null,
        role: reachable ? "goalReady" : "goal",
      });
      gNode.fx = width / 2 - 80;
      gNode.fy = 0;
    }

    // Frontier: the expanded season squad — candidates linked through its hub.
    if (frontier) {
      const hubId = `hub:${frontier.hub.clubId}::${frontier.hub.season}`;
      add({
        id: hubId,
        kind: "club",
        label: frontier.hub.club,
        img: frontier.hub.crestUrl,
        role: "candidate",
        hub: false,
        season: frontier.hub.season,
      });
      links.push({ source: frontier.sourceId, target: hubId, onPath: false });
      for (const c of frontier.candidates) {
        const isGoal = c.id === goal.id;
        const node = add({
          id: c.id,
          kind: "player",
          label: c.name,
          img: c.imageUrl ?? null,
          role: isGoal ? "goalReady" : "candidate",
          popularity: c.popularity ?? undefined,
        });
        if (isGoal) {
          node.fx = width / 2 - 80;
          node.fy = 0;
        }
        links.push({ source: hubId, target: c.id, onPath: false });
      }
    }

    // Drop cache entries that left the graph so it can't grow unbounded.
    for (const id of cache.keys()) if (!seen.has(id)) cache.delete(id);
    return { nodes, links };
  }, [chain, frontier, chainIds, goal, width]);

  const graphData = useMemo(() => ({ nodes, links }), [nodes, links]);

  // Preload faces/crests; gentle forces so the string reads left→right.
  useEffect(() => {
    for (const n of nodes) if (n.img) getImg(n.img);
  }, [nodes, getImg]);

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    // Stronger repulsion + longer links so an opened squad fans into a readable
    // ring instead of a clump of overlapping faces.
    fg.d3Force("charge")?.strength(-340).distanceMax(700);
    fg.d3Force("link")?.distance(95).strength(0.45);
    // Re-fit the view when a new squad opens (so its members are on-screen), but
    // not when a pick collapses the squad — keeping the camera steady there.
    const key = frontier ? `${frontier.hub.clubId}::${frontier.hub.season}` : null;
    if (key && key !== lastFrontierKey.current) pendingFit.current = true;
    lastFrontierKey.current = key;
    fg.d3ReheatSimulation?.();
  }, [graphData, frontier]);

  // --- interactions -------------------------------------------------------
  const openMenu = useCallback(
    async (playerId: string) => {
      setMenuFor(playerId);
      setCareer(null);
      setSeasonNote(null);
      const cached = careerCache.current.get(playerId);
      if (cached) {
        setCareer(cached);
        return;
      }
      setLoadingCareer(true);
      try {
        const detail = await getPlayer(playerId);
        careerCache.current.set(playerId, detail.career);
        setCareer(detail.career);
      } catch {
        setCareer([]);
      } finally {
        setLoadingCareer(false);
      }
    },
    []
  );

  const pickSeason = useCallback(
    async (stint: CareerStint, season: string) => {
      if (!stint.clubId || !menuFor) return;
      setLoadingSeason(`${stint.clubId}::${season}`);
      try {
        const squad = await getGameSquad(stint.clubId, season);
        const candidates = squad.players
          .filter((p) => p.id !== menuFor && !chainIds.has(p.id))
          .slice(0, CANDIDATE_LIMIT);
        // Always surface the goal if this squad reaches it.
        if (squad.players.some((p) => p.id === goal.id) && !candidates.some((p) => p.id === goal.id)) {
          const g = squad.players.find((p) => p.id === goal.id)!;
          candidates.push(g);
        }
        // Sparse seasons (e.g. an unplayed upcoming one) have no other squad data
        // — keep the menu open with a note rather than spawning an empty cluster.
        if (candidates.length === 0) {
          setSeasonNote(`No other ${squad.club.name} ${season} squad data — try another season.`);
          return;
        }
        setFrontier({
          sourceId: menuFor,
          hub: {
            clubId: stint.clubId,
            club: squad.club.name,
            season,
            crestUrl: squad.club.crestUrl,
            competition: squad.competition,
          },
          candidates,
        });
        setMenuFor(null);
        setCareer(null);
        setSeasonNote(null);
      } catch {
        /* ignore — let them retry */
      } finally {
        setLoadingSeason(null);
      }
    },
    [menuFor, chainIds, goal.id]
  );

  const commit = useCallback(
    async (cand: SquadPlayer) => {
      if (!frontier) return;
      let via: SharedLink | null = null;
      try {
        const res = await guessLink(frontier.sourceId, cand.id, {
          clubId: frontier.hub.clubId,
          season: frontier.hub.season,
        });
        via = res.links[0] ?? null;
      } catch {
        /* fall back to hub info below */
      }
      if (!via) {
        via = {
          club: frontier.hub.club,
          clubId: frontier.hub.clubId,
          crestUrl: frontier.hub.crestUrl,
          season: frontier.hub.season,
          date: null,
          competition: frontier.hub.competition,
          gamesTogether: 0,
        };
      }
      setChain((c) => [
        ...c,
        { player: { id: cand.id, name: cand.name, imageUrl: cand.imageUrl, nationality: cand.nationality }, via },
      ]);
      setFrontier(null);
    },
    [frontier]
  );

  const onNodeClick = useCallback(
    (node: GNode) => {
      if (disabled || won) return;
      if (node.kind === "club") return;
      const idx = chain.findIndex((c) => c.player.id === node.id);
      if (idx !== -1) {
        if (idx === chain.length - 1) {
          // Tip → toggle its season menu (continue forward).
          menuFor === node.id ? (setMenuFor(null), setCareer(null)) : void openMenu(node.id);
        } else {
          // An earlier pick → unselect everything after it (step back to here).
          setChain((c) => c.slice(0, idx + 1));
          setFrontier(null);
          setMenuFor(null);
          setCareer(null);
        }
        return;
      }
      // A candidate (or the reachable goal) → commit it.
      const cand = frontier?.candidates.find((c) => c.id === node.id);
      if (cand) void commit(cand);
    },
    [disabled, won, chain, menuFor, frontier, openMenu, commit]
  );

  // --- painting -----------------------------------------------------------
  const paintNode = useCallback(
    (node: GNode, ctx: CanvasRenderingContext2D, scale: number) => {
      const r = radius(node);
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const hovered = hoverId.current === node.id;
      const img = node.img ? getImg(node.img) : null;
      const ready = !!img && img.complete && img.naturalWidth > 0;
      const onPath = node.role === "start" || node.role === "chain" || node.role === "tip";

      if (node.kind === "club") {
        const s = r;
        ctx.beginPath();
        ctx.roundRect(x - s, y - s, s * 2, s * 2, 4);
        ctx.fillStyle = C.hub;
        ctx.fill();
        if (ready) {
          ctx.save();
          ctx.clip();
          drawCover(ctx, img!, x, y, s * 2, 0.5);
          ctx.restore();
        } else {
          ctx.fillStyle = "#cbd5e1";
          ctx.font = `700 ${s}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(initials(node.label), x, y);
        }
        ctx.lineWidth = (node.hub ? 2 : 1) / scale;
        ctx.strokeStyle = node.hub ? C.turf : C.dim;
        ctx.stroke();
      } else {
        // glow ring for the actionable node (tip)
        if (node.role === "tip" && !won) {
          ctx.beginPath();
          ctx.arc(x, y, r + 5 / scale, 0, 2 * Math.PI);
          ctx.strokeStyle = "rgba(21,224,129,0.35)";
          ctx.lineWidth = 5 / scale;
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 2 * Math.PI);
        if (ready) {
          ctx.save();
          ctx.clip();
          drawCover(ctx, img!, x, y, r * 2, 0.12);
          ctx.restore();
        } else {
          ctx.fillStyle = hashColor(node.label);
          ctx.fill();
          ctx.fillStyle = C.ink;
          ctx.font = `600 ${r * 0.85}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(initials(node.label), x, y);
        }
        ctx.beginPath();
        if (node.role === "goal") ctx.setLineDash([4 / scale, 3 / scale]);
        ctx.arc(x, y, r, 0, 2 * Math.PI);
        ctx.lineWidth = (onPath ? 3 : node.role === "goalReady" ? 3 : hovered ? 2.6 : 1.5) / scale;
        ctx.strokeStyle =
          node.role === "goal"
            ? C.whistle
            : node.role === "goalReady"
              ? C.electric
              : onPath
                ? C.turf
                : hovered
                  ? C.white
                  : "rgba(226,232,240,0.6)";
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Labels: chain/endpoints/hover get full names; candidates get a surname
      // so you can pick by name without hovering each face. Hidden only when
      // zoomed way out (where text would be illegible anyway).
      const important = onPath || node.role === "goal" || node.role === "goalReady" || hovered;
      const isCandidate = node.role === "candidate" && node.kind === "player";
      if (important || isCandidate || scale > 1.1) {
        const f = (important ? 11 : 10) / scale;
        const full = node.kind === "club" && node.season ? `${node.label} ${node.season}` : node.label;
        const label = isCandidate && !hovered ? node.label.split(" ").slice(-1)[0] : full;
        ctx.font = `${important ? 600 : 400} ${f}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = "rgba(2,6,12,0.72)";
        const w = ctx.measureText(label).width;
        ctx.fillRect(x - w / 2 - 2 / scale, y + r + 1 / scale, w + 4 / scale, f + 2 / scale);
        ctx.fillStyle = onPath
          ? "#d1fae5"
          : node.role === "goal" || node.role === "goalReady"
            ? "#cffafe"
            : hovered
              ? "#ffffff"
              : "#cbd5e1";
        ctx.fillText(label, x, y + r + 2 / scale);
      }
    },
    [getImg, won]
  );

  const paintPointerArea = useCallback((node: GNode, color: string, ctx: CanvasRenderingContext2D) => {
    const r = radius(node) + 4; // a touch larger than the visual so faces are easy to click
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(node.x ?? 0, node.y ?? 0, r, 0, 2 * Math.PI);
    ctx.fill();
  }, []);

  // Keep the floating season menu glued to its node every frame.
  const repositionMenu = useCallback(() => {
    const el = menuRef.current;
    if (!el || !menuFor || !fgRef.current) return;
    const node = nodes.find((n) => n.id === menuFor);
    if (node?.x == null || node?.y == null) {
      el.style.display = "none";
      return;
    }
    const { x, y } = fgRef.current.graph2ScreenCoords(node.x, node.y);
    el.style.display = "block";
    el.style.left = `${x}px`;
    el.style.top = `${y + radius(node) + 6}px`;
  }, [menuFor, nodes]);

  useEffect(() => {
    repositionMenu();
  }, [menuFor, repositionMenu]);

  return (
    <div ref={wrapRef} className="relative w-full">
      <ForceGraph2D
        ref={fgRef}
        graphData={graphData}
        width={width}
        height={520}
        backgroundColor="rgba(0,0,0,0)"
        nodeRelSize={5}
        nodeCanvasObject={paintNode as any}
        nodePointerAreaPaint={paintPointerArea as any}
        onNodeHover={(n: any) => {
          hoverId.current = n ? (n as GNode).id : null;
          const node = n as GNode | null;
          const clickable =
            !!node &&
            node.kind === "player" &&
            !won &&
            (chainIds.has(node.id) || node.role === "candidate" || node.role === "goalReady");
          if (wrapRef.current) wrapRef.current.style.cursor = clickable ? "pointer" : "grab";
          scheduleRepaint();
        }}
        linkColor={(l: any) => ((l as GLink).onPath ? C.turfSoft : C.faint)}
        linkWidth={(l: any) => ((l as GLink).onPath ? 3 : 1)}
        onNodeClick={onNodeClick as any}
        onBackgroundClick={() => {
          setMenuFor(null);
          setCareer(null);
          setSeasonNote(null);
        }}
        onNodeDragEnd={(n: any) => {
          n.fx = n.x;
          n.fy = n.y;
        }}
        onRenderFramePost={repositionMenu}
        warmupTicks={40}
        cooldownTicks={160}
        d3VelocityDecay={0.32}
        onEngineStop={() => {
          if (!pendingFit.current) return;
          pendingFit.current = false;
          fgRef.current?.zoomToFit?.(500, 80);
        }}
      />

      {/* Floating season picker, anchored under the active player node. */}
      {menuFor && (
        <div
          ref={menuRef}
          className="absolute z-20 -translate-x-1/2 w-60 max-h-64 overflow-y-auto rounded-xl border border-pitch-border bg-pitch-card/95 backdrop-blur-md shadow-2xl shadow-black/50 animate-pop"
        >
          <div className="sticky top-0 px-3 py-2 text-[11px] uppercase tracking-wider text-kit-dim font-semibold border-b border-pitch-border bg-pitch-card/95">
            Pick a season for {tip.name.split(" ").slice(-1)[0]}
          </div>
          {seasonNote && <div className="px-3 py-2 text-xs text-whistle bg-whistle/10">{seasonNote}</div>}
          {loadingCareer && <div className="px-3 py-4 text-xs text-kit-gray">Loading career…</div>}
          {!loadingCareer && career && career.length === 0 && (
            <div className="px-3 py-4 text-xs text-kit-gray">No clubs found.</div>
          )}
          <ul className="py-1">
            {career?.flatMap((stint) =>
              [...stint.seasons]
                .reverse()
                .filter(() => !!stint.clubId)
                .map((season) => {
                  const key = `${stint.clubId}::${season}`;
                  return (
                    <li key={key}>
                      <button
                        disabled={loadingSeason !== null}
                        onClick={() => pickSeason(stint, season)}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-pitch-lighter/70 disabled:opacity-50"
                      >
                        <img
                          src={stint.crestUrl ?? ""}
                          alt=""
                          className="w-4 h-4 object-contain shrink-0"
                          onError={(e) => (e.currentTarget.style.visibility = "hidden")}
                        />
                        <span className="text-sm text-kit-white truncate flex-1">{stint.club}</span>
                        <span className="text-xs text-kit-dim tabular-nums">{season}</span>
                        {loadingSeason === key && (
                          <span className="w-3 h-3 border-2 border-turf border-t-transparent rounded-full animate-spin" />
                        )}
                      </button>
                    </li>
                  );
                })
            )}
          </ul>
        </div>
      )}

      {/* Frontier hint pill */}
      {frontier && !won && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 text-xs text-kit-gray bg-pitch-card/90 border border-pitch-border px-3 py-1.5 rounded-full">
          {frontier.hub.club} {frontier.hub.season} — pick a teammate to extend the chain
        </div>
      )}
    </div>
  );
}
