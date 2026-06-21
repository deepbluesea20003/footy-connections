import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import ForceGraph2D from "react-force-graph-2d";
import type { ExploreResult, HubCluster } from "../types";
import { exploreSeparation, getSquad, getPlayer } from "../api/client";

// Hard ceiling on rendered nodes — lazy expansion must stay bounded no matter
// how much the user clicks around.
const MAX_NODES = 1500;
// How many roster/career nodes a single expansion may add.
const ROSTER_LIMIT = 12;
const CAREER_LIMIT = 8;

const isQid = (id?: string | null): id is string => !!id && /^Q\d+$/.test(id);

// Depth → colour ramp (source green, then cooling through the BFS layers).
const DEPTH_COLORS = ["#10b981", "#22d3ee", "#60a5fa", "#a78bfa", "#f472b6", "#fb923c", "#facc15"];
const depthColor = (d: number) => DEPTH_COLORS[Math.min(d, DEPTH_COLORS.length - 1)];

type Kind = "player" | "hub" | "overflow";

interface GNode {
  id: string;
  kind: Kind;
  label: string;
  depth: number;
  onPath: boolean;
  reached?: number; // players reached via a hub (for sizing)
  clubId?: string | null;
  season?: string;
  // populated by the force engine:
  x?: number;
  y?: number;
}

interface GLink {
  source: string;
  target: string;
  onPath: boolean;
}

const hubLabel = (c: Pick<HubCluster, "club" | "season">) =>
  c.season ? `${c.club} ${c.season}` : c.club;

/** Build the initial node/link set from the aggregated BFS result. */
function buildInitial(explore: ExploreResult): { nodes: GNode[]; links: GLink[] } {
  const nodes: GNode[] = [];
  const links: GLink[] = [];
  const ids = new Set<string>();
  const add = (n: GNode) => {
    if (!ids.has(n.id)) {
      ids.add(n.id);
      nodes.push(n);
    }
  };

  const sourceId = explore.path[0]?.playerId;

  // Path players (the highlighted spine).
  explore.path.forEach((step, i) =>
    add({ id: step.playerId, kind: "player", label: step.player, depth: i, onPath: true })
  );

  // Hub / overflow nodes from the clusters.
  explore.clusters.forEach((c) =>
    add({
      id: c.key,
      kind: c.key.startsWith("overflow::") ? "overflow" : "hub",
      label: c.key.startsWith("overflow::") ? c.club : hubLabel(c),
      depth: c.depth,
      onPath: c.onPath,
      reached: c.reachedCount,
      clubId: c.clubId,
      season: c.season,
    })
  );

  // Off-path clusters hang off the aggregated BFS tree (parentKey → key); the
  // on-path hubs are instead chained through their path players below.
  explore.clusters.forEach((c) => {
    if (c.onPath) return;
    const parent = c.parentKey && ids.has(c.parentKey) ? c.parentKey : sourceId;
    if (parent && parent !== c.key) links.push({ source: parent, target: c.key, onPath: false });
  });

  // Path overlay: source — hub — player — hub — … — target (bipartite chain).
  for (let i = 1; i < explore.path.length; i++) {
    const step = explore.path[i];
    const hubKey = `${step.clubId ?? step.club}::${step.season}`;
    if (!ids.has(hubKey)) continue;
    links.push({ source: explore.path[i - 1].playerId, target: hubKey, onPath: true });
    links.push({ source: step.playerId, target: hubKey, onPath: true });
  }

  return { nodes, links };
}

function Graph({ explore }: { explore: ExploreResult }) {
  const fgRef = useRef<any>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [{ nodes, links }, setData] = useState(() => buildInitial(explore));
  const [expanding, setExpanding] = useState<string | null>(null);
  const [capped, setCapped] = useState(false);

  // Reset when a new search is explored.
  useEffect(() => {
    setData(buildInitial(explore));
    setCapped(false);
  }, [explore]);

  // Responsive width; fixed height keeps the canvas bounded.
  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width));
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const graphData = useMemo(() => ({ nodes, links }), [nodes, links]);

  // Spread the (often several-hundred-node) BFS tree out instead of letting it
  // collapse into a central hairball: stronger charge repulsion + a fixed link
  // distance give a readable radial burst by depth.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    fg.d3Force("charge")?.strength(-160).distanceMax(420);
    fg.d3Force("link")?.distance(36).strength(0.7);
    fg.d3ReheatSimulation?.();
  }, [explore]);

  // Merge newly-fetched nodes/links in, deduping by id and respecting the cap.
  // Existing node object refs are preserved so the force layout doesn't reset.
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
      const keep = new Set([...ids]);
      const links = [...prev.links, ...newLinks.filter((l) => keep.has(l.source) && keep.has(l.target))];
      return { nodes: [...prev.nodes, ...added], links };
    });
  }, []);

  const onNodeClick = useCallback(
    async (node: GNode) => {
      if (expanding) return;
      try {
        if (node.kind === "hub" && isQid(node.clubId) && node.season) {
          setExpanding(node.id);
          const squad = await getSquad(node.clubId, node.season);
          const newNodes: GNode[] = squad.players.slice(0, ROSTER_LIMIT).map((p) => ({
            id: p.id,
            kind: "player",
            label: p.name,
            depth: node.depth,
            onPath: false,
          }));
          merge(newNodes, newNodes.map((n) => ({ source: n.id, target: node.id, onPath: false })));
        } else if (node.kind === "player") {
          setExpanding(node.id);
          const detail = await getPlayer(node.id);
          const stints = detail.career.filter((s) => isQid(s.clubId)).slice(0, CAREER_LIMIT);
          const newNodes: GNode[] = [];
          const newLinks: GLink[] = [];
          for (const s of stints) {
            const season = s.lastSeason || s.seasons[s.seasons.length - 1];
            const key = `${s.clubId}::${season}`;
            newNodes.push({
              id: key,
              kind: "hub",
              label: `${s.club} ${season}`,
              depth: node.depth + 1,
              onPath: false,
              clubId: s.clubId,
              season,
            });
            newLinks.push({ source: node.id, target: key, onPath: false });
          }
          merge(newNodes, newLinks);
        }
      } catch {
        /* expansion is best-effort; ignore fetch errors */
      } finally {
        setExpanding(null);
      }
    },
    [expanding, merge]
  );

  const nodeRadius = (n: GNode) => {
    if (n.kind === "player") return n.onPath ? 6 : 4;
    if (n.kind === "overflow") return 5 + Math.min(8, Math.log2((n.reached ?? 1) + 1));
    return 4 + Math.min(10, Math.log2((n.reached ?? 1) + 1)); // hub, sized by reach
  };

  const paintNode = useCallback(
    (node: GNode, ctx: CanvasRenderingContext2D, scale: number) => {
      const r = nodeRadius(node);
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      ctx.beginPath();
      if (node.kind === "player") {
        ctx.arc(x, y, r, 0, 2 * Math.PI);
        ctx.fillStyle = node.onPath ? "#10b981" : "#94a3b8";
      } else if (node.kind === "overflow") {
        ctx.rect(x - r, y - r, r * 2, r * 2);
        ctx.fillStyle = "#475569";
      } else {
        ctx.rect(x - r, y - r, r * 2, r * 2);
        ctx.fillStyle = depthColor(node.depth);
      }
      ctx.fill();
      if (node.onPath) {
        ctx.lineWidth = 1.5 / scale;
        ctx.strokeStyle = "#ecfdf5";
        ctx.stroke();
      }
      // Labels only when zoomed in (or always for path endpoints) — avoids
      // drawing hundreds of strings at low zoom.
      if (scale > 1.6 || node.onPath) {
        const fontSize = Math.max(2, 11 / scale);
        ctx.font = `${node.onPath ? 600 : 400} ${fontSize}px sans-serif`;
        ctx.fillStyle = "#e2e8f0";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(node.label, x, y + r + 1);
      }
    },
    []
  );

  const paintPointerArea = useCallback((node: GNode, color: string, ctx: CanvasRenderingContext2D) => {
    const r = nodeRadius(node) + 2;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.rect((node.x ?? 0) - r, (node.y ?? 0) - r, r * 2, r * 2);
    ctx.fill();
  }, []);

  return (
    <div ref={wrapRef} className="relative w-full">
      <ForceGraph2D
        ref={fgRef}
        graphData={graphData}
        width={width}
        height={520}
        backgroundColor="rgba(0,0,0,0)"
        nodeRelSize={4}
        nodeCanvasObject={paintNode as any}
        nodePointerAreaPaint={paintPointerArea as any}
        nodeLabel={(n: any) => `${(n as GNode).label}${(n as GNode).reached ? ` · ${(n as GNode).reached} reached` : ""}`}
        linkColor={(l: any) => ((l as GLink).onPath ? "rgba(16,185,129,0.85)" : "rgba(148,163,184,0.25)")}
        linkWidth={(l: any) => ((l as GLink).onPath ? 2.5 : 0.5)}
        onNodeClick={onNodeClick as any}
        warmupTicks={80}
        cooldownTicks={200}
        d3VelocityDecay={0.28}
        onEngineStop={() => fgRef.current?.zoomToFit(500, 60)}
      />
      {expanding && (
        <div className="absolute top-2 right-2 text-xs text-kit-dim bg-pitch/80 px-2 py-1 rounded">Expanding…</div>
      )}
      {capped && (
        <div className="absolute bottom-2 left-2 text-xs text-foul bg-pitch/80 px-2 py-1 rounded">
          Node limit reached ({MAX_NODES}) — collapse or refine to explore further.
        </div>
      )}
    </div>
  );
}

/** Lazily fetches the aggregated BFS for the given pair, then renders it. The
 *  whole module (incl. the force-graph lib) is code-split via React.lazy in
 *  Results, so it loads only when the user opens the panel. */
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
        Tracing the search…
      </div>
    );
  }

  return (
    <div className="w-full rounded-xl border border-pitch-border bg-pitch-light overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 border-b border-pitch-border text-xs text-kit-gray">
        <span>
          BFS visited <strong className="text-kit-white">{explore.totals.visitedPlayers.toLocaleString()}</strong> players
          via <strong className="text-kit-white">{explore.totals.visitedHubs.toLocaleString()}</strong> club-seasons
          across <strong className="text-kit-white">{Math.max(0, explore.layers.length - 1)}</strong> layers.
        </span>
        <span className="text-kit-dim">Click a node to expand · drag to move · scroll to zoom</span>
      </div>
      <Graph explore={explore} />
    </div>
  );
}
