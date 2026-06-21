import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import ForceGraph2D from "react-force-graph-2d";
import type { ExploreResult } from "../types";
import { exploreSeparation, getSquad, getPlayer } from "../api/client";

// Lazy expansion must stay bounded no matter how much the user clicks around.
const MAX_NODES = 600;
const ROSTER_LIMIT = 14; // faces added when expanding a club
const CAREER_LIMIT = 10; // clubs added when expanding a player

const isQid = (id?: string | null): id is string => !!id && /^Q\d+$/.test(id);

type Kind = "player" | "club";

interface GNode {
  id: string;
  kind: Kind;
  label: string;
  img?: string | null;
  onPath: boolean;
  popularity?: number;
  season?: string;
  clubId?: string | null;
  expanded?: boolean;
  x?: number;
  y?: number;
}

interface GLink {
  source: string | { id: string };
  target: string | { id: string };
  onPath: boolean;
}

const idOf = (e: GLink["source"]): string => (typeof e === "object" && e !== null ? e.id : e);
const linkKey = (s: GLink["source"], t: GLink["target"]) => {
  const a = idOf(s);
  const b = idOf(t);
  return a < b ? `${a}|${b}` : `${b}|${a}`;
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

// Deterministic pleasant colour for an initials-fallback avatar.
function hashColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return `hsl(${Math.abs(h) % 360} 55% 55%)`;
}

const radius = (n: GNode) =>
  n.kind === "club" ? 13 : n.onPath ? 17 : 11 + Math.min(5, (n.popularity ?? 0) * 2);

function buildInitial(explore: ExploreResult): { nodes: GNode[]; links: GLink[] } {
  const nodes: GNode[] = [];
  const links: GLink[] = [];
  const ids = new Set<string>();
  const linkIds = new Set<string>();
  const addNode = (n: GNode) => {
    if (!ids.has(n.id)) {
      ids.add(n.id);
      nodes.push(n);
    }
  };
  const addLink = (source: string, target: string, onPath: boolean) => {
    if (!ids.has(source) || !ids.has(target)) return;
    const k = linkKey(source, target);
    if (linkIds.has(k)) return;
    linkIds.add(k);
    links.push({ source, target, onPath });
  };

  // Path players are the stars — added first so they keep onPath=true.
  explore.path.forEach((s) =>
    addNode({ id: s.playerId, kind: "player", label: s.player, img: s.playerImageUrl ?? null, onPath: true })
  );

  explore.connectors.forEach((c) => {
    addNode({ id: c.key, kind: "club", label: c.club, season: c.season, clubId: c.clubId, img: c.crestUrl ?? null, onPath: true });
    c.squad.forEach((p) => {
      const endpoint = p.id === c.fromPlayerId || p.id === c.toPlayerId;
      addNode({ id: p.id, kind: "player", label: p.name, img: p.imageUrl ?? null, popularity: p.popularity ?? undefined, onPath: endpoint });
      addLink(p.id, c.key, endpoint);
    });
    addLink(c.fromPlayerId, c.key, true);
    addLink(c.toPlayerId, c.key, true);
  });

  return { nodes, links };
}

function Graph({ explore }: { explore: ExploreResult }) {
  const fgRef = useRef<any>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const imgCache = useRef<Map<string, HTMLImageElement>>(new Map());
  const repaintPending = useRef(false);
  const hoverId = useRef<string | null>(null);
  const [width, setWidth] = useState(800);
  const [{ nodes, links }, setData] = useState(() => buildInitial(explore));
  const [busy, setBusy] = useState(false);
  const [capped, setCapped] = useState(false);

  useEffect(() => {
    setData(buildInitial(explore));
    setCapped(false);
  }, [explore]);

  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width));
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  // Repaint when a face/crest finishes loading (the render loop has usually
  // cooled by then). Throttled to one resume per frame.
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
      img.onload = scheduleRepaint; // no crossOrigin: we draw but never read pixels
      img.src = url;
      imgCache.current.set(url, img);
      return img;
    },
    [scheduleRepaint]
  );

  // Kick off image loads as soon as nodes appear, not only on first paint.
  useEffect(() => {
    for (const n of nodes) if (n.img) getImg(n.img);
  }, [nodes, getImg]);

  // Spread faces out so they don't overlap; reheat so new expansions settle.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    fg.d3Force("charge")?.strength(-260).distanceMax(500);
    fg.d3Force("link")?.distance(60).strength(0.5);
    fg.d3ReheatSimulation?.();
  }, [explore]);

  const graphData = useMemo(() => ({ nodes, links }), [nodes, links]);

  const merge = useCallback((newNodes: GNode[], newLinks: GLink[]) => {
    setData((prev) => {
      const ids = new Set(prev.nodes.map((n) => n.id));
      const added: GNode[] = [];
      for (const n of newNodes) {
        if (ids.has(n.id)) continue;
        if (prev.nodes.length + added.length >= MAX_NODES) {
          setCapped(true);
          break;
        }
        ids.add(n.id);
        added.push(n);
      }
      const seen = new Set(prev.links.map((l) => linkKey(l.source, l.target)));
      const addedLinks: GLink[] = [];
      for (const l of newLinks) {
        if (!ids.has(idOf(l.source)) || !ids.has(idOf(l.target))) continue;
        const k = linkKey(l.source, l.target);
        if (seen.has(k)) continue;
        seen.add(k);
        addedLinks.push(l);
      }
      return { nodes: [...prev.nodes, ...added], links: [...prev.links, ...addedLinks] };
    });
  }, []);

  const onNodeClick = useCallback(
    async (node: GNode) => {
      if (busy || node.expanded) return;
      try {
        if (node.kind === "player") {
          node.expanded = true;
          setBusy(true);
          const detail = await getPlayer(node.id);
          const newNodes: GNode[] = [];
          const newLinks: GLink[] = [];
          for (const s of detail.career.filter((c) => isQid(c.clubId)).slice(0, CAREER_LIMIT)) {
            const season = s.lastSeason || s.seasons[s.seasons.length - 1];
            const key = `${s.clubId}::${season}`;
            newNodes.push({ id: key, kind: "club", label: s.club, season, clubId: s.clubId, img: s.crestUrl, onPath: false });
            newLinks.push({ source: node.id, target: key, onPath: false });
          }
          merge(newNodes, newLinks);
        } else if (node.kind === "club" && isQid(node.clubId) && node.season) {
          node.expanded = true;
          setBusy(true);
          const squad = await getSquad(node.clubId, node.season);
          const newNodes: GNode[] = [];
          const newLinks: GLink[] = [];
          for (const p of squad.players.slice(0, ROSTER_LIMIT)) {
            newNodes.push({ id: p.id, kind: "player", label: p.name, img: p.imageUrl, popularity: p.popularity ?? undefined, onPath: false });
            newLinks.push({ source: p.id, target: node.id, onPath: false });
          }
          merge(newNodes, newLinks);
        }
      } catch {
        node.expanded = false; // allow retry
      } finally {
        setBusy(false);
      }
    },
    [busy, merge]
  );

  const paintNode = useCallback(
    (node: GNode, ctx: CanvasRenderingContext2D, scale: number) => {
      const r = radius(node);
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const hovered = hoverId.current === node.id;
      const img = node.img ? getImg(node.img) : null;
      const ready = !!img && img.complete && img.naturalWidth > 0;

      if (node.kind === "club") {
        // Crest badge (rounded square) so clubs read as the grouping, not a face.
        const s = r;
        ctx.beginPath();
        ctx.roundRect(x - s, y - s, s * 2, s * 2, 4);
        ctx.fillStyle = "#1e293b";
        ctx.fill();
        if (ready) {
          ctx.save();
          ctx.clip();
          ctx.drawImage(img!, x - s, y - s, s * 2, s * 2);
          ctx.restore();
        } else {
          ctx.fillStyle = "#cbd5e1";
          ctx.font = `700 ${s}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(initials(node.label), x, y);
        }
        ctx.lineWidth = (node.onPath ? 2 : 1) / scale;
        ctx.strokeStyle = node.onPath ? "#fbbf24" : "rgba(148,163,184,0.5)";
        ctx.stroke();
      } else {
        // Player face (circular), the star of the show.
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 2 * Math.PI);
        if (ready) {
          ctx.save();
          ctx.clip();
          ctx.drawImage(img!, x - r, y - r, r * 2, r * 2);
          ctx.restore();
        } else {
          ctx.fillStyle = hashColor(node.label);
          ctx.fill();
          ctx.fillStyle = "#0b0f14";
          ctx.font = `600 ${r * 0.85}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(initials(node.label), x, y);
        }
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 2 * Math.PI);
        ctx.lineWidth = (node.onPath ? 3 : hovered ? 2.5 : 1.4) / scale;
        ctx.strokeStyle = node.onPath ? "#10b981" : hovered ? "#ffffff" : "rgba(226,232,240,0.55)";
        ctx.stroke();
      }

      // Labels: always for path nodes / hover, otherwise only when zoomed in.
      if (node.onPath || hovered || scale > 1.3) {
        const f = 11 / scale;
        const label = node.kind === "club" && node.season ? `${node.label} ${node.season}` : node.label;
        ctx.font = `${node.onPath || hovered ? 600 : 400} ${f}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = "rgba(2,6,12,0.7)";
        const w = ctx.measureText(label).width;
        ctx.fillRect(x - w / 2 - 2 / scale, y + r + 1 / scale, w + 4 / scale, f + 2 / scale);
        ctx.fillStyle = node.onPath ? "#d1fae5" : "#e2e8f0";
        ctx.fillText(label, x, y + r + 2 / scale);
      }
    },
    [getImg]
  );

  const paintPointerArea = useCallback((node: GNode, color: string, ctx: CanvasRenderingContext2D) => {
    const r = radius(node) + 2;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(node.x ?? 0, node.y ?? 0, r, 0, 2 * Math.PI);
    ctx.fill();
  }, []);

  return (
    <div ref={wrapRef} className="relative w-full">
      <ForceGraph2D
        ref={fgRef}
        graphData={graphData}
        width={width}
        height={540}
        backgroundColor="rgba(0,0,0,0)"
        nodeRelSize={5}
        nodeCanvasObject={paintNode as any}
        nodePointerAreaPaint={paintPointerArea as any}
        onNodeHover={(n: any) => {
          hoverId.current = n ? (n as GNode).id : null;
          if (wrapRef.current) wrapRef.current.style.cursor = n ? "pointer" : "grab";
          scheduleRepaint();
        }}
        linkColor={(l: any) => ((l as GLink).onPath ? "rgba(16,185,129,0.8)" : "rgba(148,163,184,0.22)")}
        linkWidth={(l: any) => ((l as GLink).onPath ? 3 : 1)}
        onNodeClick={onNodeClick as any}
        onNodeDragEnd={(n: any) => {
          n.fx = n.x;
          n.fy = n.y;
        }}
        warmupTicks={60}
        cooldownTicks={200}
        d3VelocityDecay={0.3}
        onEngineStop={() => fgRef.current?.zoomToFit(500, 70)}
      />
      {busy && (
        <div className="absolute top-2 right-2 text-xs text-kit-dim bg-pitch/80 px-2 py-1 rounded">Expanding…</div>
      )}
      {capped && (
        <div className="absolute bottom-2 left-2 text-xs text-foul bg-pitch/80 px-2 py-1 rounded">
          Showing {MAX_NODES} players — collapse or start a new search to explore further.
        </div>
      )}
    </div>
  );
}

/** Lazily fetches the connection graph for a pair, then renders it. Code-split
 *  via React.lazy in Results, so the force-graph lib loads only when opened. */
export default function BfsGraphPanel({ player1Id, player2Id }: { player1Id: string; player2Id: string }) {
  const [explore, setExplore] = useState<ExploreResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setExplore(null);
    setError(null);
    exploreSeparation(player1Id, player2Id, controller.signal)
      .then((res) => !controller.signal.aborted && setExplore(res))
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Failed to load graph");
      });
    return () => controller.abort();
  }, [player1Id, player2Id]);

  if (error) return <p className="text-foul text-sm py-8 text-center">{error}</p>;
  if (!explore) {
    return (
      <div className="flex items-center justify-center gap-3 py-16 text-kit-gray text-sm">
        <div className="w-5 h-5 border-2 border-turf border-t-transparent rounded-full animate-spin" />
        Tracing the connection…
      </div>
    );
  }

  return (
    <div className="w-full rounded-xl border border-pitch-border bg-pitch-light overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 border-b border-pitch-border text-xs text-kit-gray">
        <span>
          We sifted <strong className="text-kit-white">{explore.totals.visitedPlayers.toLocaleString()}</strong> players to
          link these two. <span className="text-turf">Click a face</span> to see who else they played with — wander the web.
        </span>
      </div>
      <Graph explore={explore} />
    </div>
  );
}
