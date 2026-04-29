import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import Graph from "graphology";
import Sigma from "sigma";
import FA2Layout from "graphology-layout-forceatlas2/worker";
import forceAtlas2 from "graphology-layout-forceatlas2";
import circular from "graphology-layout/circular";
import { api, type GraphData, type NodeDetail } from "../lib/api";

const TYPE_COLORS: Record<string, string> = {
  Person: "#a1a1aa",
  Pet: "#f59e0b",
  Project: "#0ea5e9",
  Place: "#10b981",
  Device: "#a78bfa",
  Topic: "#71717a",
  Organization: "#fb7185",
  Event: "#fb923c",
  Task: "#f87171",
  Preference: "#f472b6",
  Document: "#a3e635",
};

const DEFAULT_COLOR = "#9ca3af";
const colorFor = (type: string) => TYPE_COLORS[type] ?? DEFAULT_COLOR;

interface Props {
  open: boolean;
  onClose: () => void;
  refreshKey: number;
}

export function GraphView({ open, onClose, refreshKey }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const layoutRef = useRef<FA2Layout | null>(null);

  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<NodeDetail | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  // Fetch graph on open + on refresh
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    api
      .graph()
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [open, refreshKey]);

  // Build + render the graph
  useEffect(() => {
    if (!open || !data || !containerRef.current) return;
    if (data.nodes.length === 0) return;

    const graph = new Graph({ multi: false });
    const visibleIds = new Set<string>();

    for (const n of data.nodes) {
      if (hidden.has(n.type)) continue;
      graph.addNode(n.id, {
        label: n.name,
        size: 6,
        color: colorFor(n.type),
        nodeType: n.type,
      });
      visibleIds.add(n.id);
    }

    for (const e of data.edges) {
      if (!visibleIds.has(e.fromId) || !visibleIds.has(e.toId)) continue;
      if (graph.hasEdge(e.fromId, e.toId)) continue;
      graph.addEdgeWithKey(e.id, e.fromId, e.toId, {
        label: e.type,
        size: 1,
        color: "#3f3f46",
        type: "arrow",
      });
    }

    if (graph.order === 0) return;

    // Scale node size by degree (hubs bigger).
    graph.forEachNode((id) => {
      const degree = graph.degree(id);
      graph.setNodeAttribute(id, "size", 4 + Math.min(degree * 1.4, 14));
    });

    circular.assign(graph);

    const sigma = new Sigma(graph, containerRef.current, {
      labelColor: { color: "#a1a1aa" },
      labelSize: 12,
      labelWeight: "500",
      labelDensity: 0.8,
      labelGridCellSize: 80,
      defaultEdgeColor: "#3f3f46",
      renderEdgeLabels: true,
      edgeLabelColor: { color: "#52525b" },
      edgeLabelSize: 9,
    });
    sigmaRef.current = sigma;

    sigma.on("clickNode", ({ node }) => {
      api
        .nodeDetail(node)
        .then(setSelectedDetail)
        .catch(() => undefined);
    });
    sigma.on("clickStage", () => setSelectedDetail(null));

    let hoveredNode: string | null = null;
    sigma.on("enterNode", ({ node }) => {
      hoveredNode = node;
      sigma.refresh();
    });
    sigma.on("leaveNode", () => {
      hoveredNode = null;
      sigma.refresh();
    });

    sigma.setSetting("nodeReducer", (node, attr) => {
      if (!hoveredNode) return attr;
      const isFocus =
        node === hoveredNode || graph.neighbors(hoveredNode).includes(node);
      return isFocus ? attr : { ...attr, color: "#27272a", label: "" };
    });
    sigma.setSetting("edgeReducer", (edge, attr) => {
      if (!hoveredNode) return attr;
      const [s, t] = graph.extremities(edge);
      const involves = s === hoveredNode || t === hoveredNode;
      return involves
        ? { ...attr, color: "#71717a" }
        : { ...attr, hidden: true };
    });

    const settings = forceAtlas2.inferSettings(graph);
    const layout = new FA2Layout(graph, {
      settings: { ...settings, scalingRatio: 10, gravity: 1, slowDown: 4 },
    });
    layoutRef.current = layout;
    layout.start();
    const stopTimer = setTimeout(() => layout.stop(), 4000);

    return () => {
      clearTimeout(stopTimer);
      layout.kill();
      sigma.kill();
      sigmaRef.current = null;
      layoutRef.current = null;
    };
  }, [open, data, hidden]);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const presentTypes = useMemo(() => {
    if (!data) return [];
    return Array.from(new Set(data.nodes.map((n) => n.type))).sort();
  }, [data]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950 animate-fade-in">
      <div ref={containerRef} className="absolute inset-0" />

      <header className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between border-b border-zinc-900/80 bg-zinc-950/80 px-6 py-3 backdrop-blur">
        <div className="flex items-baseline gap-2 font-mono text-sm">
          <span className="text-zinc-200">memory graph</span>
          {data && (
            <span className="text-zinc-600">
              {data.nodes.length}n / {data.edges.length}e
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          aria-label="close graph"
          className="flex h-7 w-7 items-center justify-center rounded text-zinc-400 transition hover:bg-zinc-900 hover:text-zinc-100"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </header>

      {presentTypes.length > 0 && (
        <div className="absolute left-1/2 top-14 z-10 flex max-w-3xl -translate-x-1/2 flex-wrap justify-center gap-1.5 rounded-full border border-zinc-900 bg-zinc-950/80 px-3 py-2 backdrop-blur">
          {presentTypes.map((type) => {
            const isHidden = hidden.has(type);
            return (
              <button
                key={type}
                onClick={() =>
                  setHidden((curr) => {
                    const next = new Set(curr);
                    if (isHidden) next.delete(type);
                    else next.add(type);
                    return next;
                  })
                }
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition ${
                  isHidden
                    ? "border-zinc-800 bg-zinc-900/40 text-zinc-600"
                    : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-600"
                }`}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: colorFor(type) }}
                />
                <span className={isHidden ? "line-through" : ""}>{type}</span>
              </button>
            );
          })}
        </div>
      )}

      {selectedDetail && (
        <NodeDetailPanel
          detail={selectedDetail}
          onClose={() => setSelectedDetail(null)}
        />
      )}

      {!data && !error && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-zinc-500">
          loading…
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-red-400">
          {error}
        </div>
      )}
      {data && data.nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-zinc-500">
          no facts yet — chat to fill the graph.
        </div>
      )}
    </div>
  );
}

function NodeDetailPanel({
  detail,
  onClose,
}: {
  detail: NodeDetail;
  onClose: () => void;
}) {
  const propEntries = Object.entries(detail.node.props);
  return (
    <aside className="absolute right-4 top-28 bottom-4 z-10 flex w-80 flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/95 shadow-2xl backdrop-blur animate-fade-in">
      <header className="flex items-start justify-between gap-2 border-b border-zinc-900 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-zinc-100">
            {detail.node.name}
          </p>
          <div className="mt-1 flex items-center gap-1.5">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: colorFor(detail.node.type) }}
            />
            <span className="text-xs text-zinc-500">{detail.node.type}</span>
          </div>
        </div>
        <button
          onClick={onClose}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-zinc-500 transition hover:bg-zinc-900 hover:text-zinc-100"
          aria-label="close detail"
        >
          <X className="h-3 w-3" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {propEntries.length > 0 && (
          <Section title="props">
            <ul className="flex flex-col gap-1">
              {propEntries.map(([k, v]) => (
                <li key={k} className="flex items-baseline gap-2 text-xs">
                  <span className="font-mono text-zinc-500">{k}</span>
                  <span className="break-words text-zinc-300">
                    {typeof v === "string" ? v : JSON.stringify(v)}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section title={`neighbors (${detail.neighbors.length})`}>
          {detail.neighbors.length === 0 ? (
            <p className="text-xs text-zinc-600">no edges.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {detail.neighbors.map((n) => (
                <li
                  key={n.edge.id}
                  className="rounded-md border border-zinc-900 bg-zinc-900/30 px-2.5 py-1.5"
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: colorFor(n.node.type) }}
                    />
                    <span className="text-sm text-zinc-200">{n.node.name}</span>
                    <span className="ml-auto font-mono text-[10px] text-zinc-600">
                      {n.edge.type}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[10px] text-zinc-500">{n.node.type}</p>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {detail.provenance.length > 0 && (
          <Section title="provenance">
            <ul className="flex flex-col gap-1">
              {detail.provenance.map((p, i) => (
                <li key={i} className="text-xs text-zinc-500">
                  <span className="font-mono">{p.source}</span>
                  <span className="ml-2 text-zinc-600">
                    {new Date(p.createdAt).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-4 last:mb-0">
      <p className="mb-2 text-xs uppercase tracking-wider text-zinc-600">{title}</p>
      {children}
    </section>
  );
}
