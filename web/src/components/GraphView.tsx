import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import Graph from "graphology";
import Sigma from "sigma";
import FA2Layout from "graphology-layout-forceatlas2/worker";
import forceAtlas2 from "graphology-layout-forceatlas2";
import circular from "graphology-layout/circular";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  api,
  type GraphData,
  type NodeDetail,
  type NodeLayoutEntry,
  type NodeNote,
} from "../lib/api";

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

const FA2_DURATION_MS = 4000;

interface Props {
  open: boolean;
  onClose: () => void;
  refreshKey: number;
}

export function GraphView({ open, onClose, refreshKey }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const layoutRef = useRef<FA2Layout | null>(null);
  const graphRef = useRef<Graph | null>(null);

  const [data, setData] = useState<GraphData | null>(null);
  const [layout, setLayout] = useState<NodeLayoutEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<NodeDetail | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");

  // Fetch graph + saved layout on open + on refresh
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    Promise.all([api.graph(), api.getLayout().catch(() => [] as NodeLayoutEntry[])])
      .then(([d, l]) => {
        if (cancelled) return;
        setData(d);
        setLayout(l);
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
    const layoutMap = new Map(layout?.map((p) => [p.nodeId, p]) ?? []);

    for (const n of data.nodes) {
      if (hidden.has(n.type)) continue;
      const saved = layoutMap.get(n.id);
      graph.addNode(n.id, {
        label: n.name,
        size: 6,
        color: colorFor(n.type),
        nodeType: n.type,
        ...(saved ? { x: saved.x, y: saved.y } : {}),
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

    // Seed coords for any node that didn't have a saved layout, so FA2 has
    // something non-degenerate to work from.
    const newNodes: string[] = [];
    graph.forEachNode((id, attr) => {
      if (typeof attr.x !== "number" || typeof attr.y !== "number") {
        newNodes.push(id);
      }
    });
    if (newNodes.length === graph.order) {
      // No saved layout at all — fresh circular seed.
      circular.assign(graph);
    } else if (newNodes.length > 0) {
      // Seed unplaced nodes near the centroid of placed ones.
      let cx = 0;
      let cy = 0;
      let placed = 0;
      graph.forEachNode((_id, attr) => {
        if (typeof attr.x === "number" && typeof attr.y === "number") {
          cx += attr.x;
          cy += attr.y;
          placed++;
        }
      });
      if (placed > 0) {
        cx /= placed;
        cy /= placed;
      }
      for (let i = 0; i < newNodes.length; i++) {
        const angle = (i / newNodes.length) * Math.PI * 2;
        graph.setNodeAttribute(newNodes[i]!, "x", cx + Math.cos(angle) * 5);
        graph.setNodeAttribute(newNodes[i]!, "y", cy + Math.sin(angle) * 5);
      }
    }

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
    graphRef.current = graph;

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
      const isFocus = node === hoveredNode || graph.neighbors(hoveredNode).includes(node);
      return isFocus ? attr : { ...attr, color: "#27272a", label: "" };
    });
    sigma.setSetting("edgeReducer", (edge, attr) => {
      if (!hoveredNode) return attr;
      const [s, t] = graph.extremities(edge);
      const involves = s === hoveredNode || t === hoveredNode;
      return involves ? { ...attr, color: "#71717a" } : { ...attr, hidden: true };
    });

    // If we restored a saved layout, run FA2 only weakly (or not at all) so
    // existing positions stay put. Fresh layouts get the original strong run.
    const hasSavedLayout = layoutMap.size > 0;
    const settings = forceAtlas2.inferSettings(graph);
    const fa2Settings = hasSavedLayout
      ? { ...settings, scalingRatio: 1, gravity: 0.1, slowDown: 20 }
      : { ...settings, scalingRatio: 10, gravity: 1, slowDown: 4 };
    const layoutWorker = new FA2Layout(graph, { settings: fa2Settings });
    layoutRef.current = layoutWorker;
    layoutWorker.start();

    const stopTimer = setTimeout(() => {
      layoutWorker.stop();
      // Snapshot positions for next open.
      const positions: NodeLayoutEntry[] = [];
      graph.forEachNode((id, attr) => {
        if (typeof attr.x === "number" && typeof attr.y === "number") {
          positions.push({ nodeId: id, x: attr.x, y: attr.y });
        }
      });
      if (positions.length > 0) {
        api.saveLayout(positions).catch(() => undefined);
      }
    }, FA2_DURATION_MS);

    return () => {
      clearTimeout(stopTimer);
      layoutWorker.kill();
      sigma.kill();
      sigmaRef.current = null;
      layoutRef.current = null;
      graphRef.current = null;
    };
  }, [open, data, layout, hidden]);

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

  const searchMatches = useMemo(() => {
    if (!data || !searchQuery.trim()) return [];
    const q = searchQuery.trim().toLowerCase();
    return data.nodes
      .filter((n) => n.name.toLowerCase().includes(q) && !hidden.has(n.type))
      .slice(0, 8);
  }, [data, searchQuery, hidden]);

  function focusNode(id: string) {
    const sigma = sigmaRef.current;
    const graph = graphRef.current;
    if (!sigma || !graph || !graph.hasNode(id)) return;
    const x = graph.getNodeAttribute(id, "x") as number | undefined;
    const y = graph.getNodeAttribute(id, "y") as number | undefined;
    if (typeof x !== "number" || typeof y !== "number") return;
    const camera = sigma.getCamera();
    camera.animate({ x, y, ratio: 0.3 }, { duration: 400 });
    api
      .nodeDetail(id)
      .then(setSelectedDetail)
      .catch(() => undefined);
    setSearchQuery("");
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950 animate-fade-in">
      <div ref={containerRef} className="absolute inset-0" />

      <header className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between gap-4 border-b border-zinc-900/80 bg-zinc-950/80 px-6 py-3 backdrop-blur">
        <div className="flex items-baseline gap-2 font-mono text-sm">
          <span className="text-zinc-200">memory graph</span>
          {data && (
            <span className="text-zinc-600">
              {data.nodes.length}n / {data.edges.length}e
            </span>
          )}
        </div>

        {data && data.nodes.length > 0 && (
          <div className="relative max-w-xs flex-1">
            <div className="flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 transition focus-within:border-zinc-700 focus-within:bg-zinc-900">
              <Search className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="search nodes…"
                className="min-w-0 flex-1 bg-transparent text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && searchMatches[0]) {
                    e.preventDefault();
                    focusNode(searchMatches[0].id);
                  } else if (e.key === "Escape") {
                    setSearchQuery("");
                  }
                }}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  aria-label="clear search"
                  className="text-zinc-500 transition hover:text-zinc-200"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
            {searchQuery && searchMatches.length > 0 && (
              <ul className="absolute left-0 right-0 top-full mt-1 max-h-72 overflow-y-auto rounded-md border border-zinc-800 bg-zinc-950/95 py-1 shadow-2xl backdrop-blur">
                {searchMatches.map((n) => (
                  <li key={n.id}>
                    <button
                      onClick={() => focusNode(n.id)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition hover:bg-zinc-900"
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: colorFor(n.type) }}
                      />
                      <span className="flex-1 truncate text-xs text-zinc-200">
                        {n.name}
                      </span>
                      <span className="text-[10px] text-zinc-500">{n.type}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {searchQuery && searchMatches.length === 0 && (
              <p className="absolute left-0 right-0 top-full mt-1 rounded-md border border-zinc-800 bg-zinc-950/95 px-3 py-2 text-xs text-zinc-500 shadow-2xl backdrop-blur">
                no matches.
              </p>
            )}
          </div>
        )}

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
          <p className="truncate text-sm font-medium text-zinc-100">{detail.node.name}</p>
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
        <Section title="note">
          <NoteEditor nodeId={detail.node.id} />
        </Section>

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

const NOTE_PROSE = [
  "prose prose-invert prose-xs max-w-none",
  "prose-p:my-1.5 prose-p:leading-relaxed prose-p:text-xs",
  "prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 prose-li:text-xs",
  "prose-headings:text-zinc-100 prose-headings:font-medium",
  "prose-strong:text-zinc-100",
  "prose-em:text-zinc-200",
  "prose-a:text-sky-400 prose-a:no-underline hover:prose-a:underline",
  "prose-code:bg-zinc-900 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-zinc-200 prose-code:text-[0.8em] prose-code:font-mono prose-code:before:content-none prose-code:after:content-none",
  "prose-pre:bg-zinc-900 prose-pre:border prose-pre:border-zinc-800 prose-pre:rounded prose-pre:my-2",
  "prose-blockquote:border-l-zinc-700 prose-blockquote:text-zinc-400",
  "prose-hr:border-zinc-800",
].join(" ");

/**
 * Markdown note attached 1:1 to a node. Save-on-blur — the editor flushes to
 * the server when focus leaves the textarea (or the panel unmounts mid-edit).
 * An empty-after-trim body is treated as a delete by the server, so an unused
 * editor doesn't leave empty rows behind.
 */
function NoteEditor({ nodeId }: { nodeId: string }) {
  const [note, setNote] = useState<NodeNote | null>(null);
  const [draft, setDraft] = useState("");
  // Track the body the server last confirmed so blur can be a no-op when
  // nothing changed (avoid an unnecessary PUT round-trip on every focus loss).
  const savedRef = useRef("");
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [status, setStatus] = useState<"idle" | "loading" | "saving" | "error">(
    "loading",
  );
  const [error, setError] = useState<string | null>(null);

  // Fetch the note for this node. Re-runs when nodeId changes (panel re-uses
  // the same NoteEditor instance when the user clicks a different node).
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setError(null);
    api
      .getNote(nodeId)
      .then((res) => {
        if (cancelled) return;
        const body = res.note?.body ?? "";
        setNote(res.note);
        setDraft(body);
        savedRef.current = body;
        setStatus("idle");
        setTab("edit");
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [nodeId]);

  // Flush any pending changes when the editor unmounts mid-edit (panel close,
  // node switch, modal close). Keep this ref-driven so we don't need to wire
  // through extra deps.
  const flushRef = useRef<() => Promise<void>>(async () => undefined);
  flushRef.current = async () => {
    if (draft === savedRef.current) return;
    try {
      const res = await api.setNote(nodeId, draft);
      setNote(res.note);
      savedRef.current = draft.trim().length === 0 ? "" : draft;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  };
  useEffect(() => {
    return () => {
      // fire-and-forget; we can't await in cleanup
      void flushRef.current();
    };
  }, []);

  async function handleBlur() {
    if (draft === savedRef.current) return;
    setStatus("saving");
    try {
      const res = await api.setNote(nodeId, draft);
      setNote(res.note);
      savedRef.current = draft.trim().length === 0 ? "" : draft;
      setStatus("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }

  if (status === "loading") {
    return <p className="text-xs text-zinc-600">loading…</p>;
  }
  if (status === "error" && error) {
    return <p className="text-xs text-red-400">note error: {error}</p>;
  }

  const isEmpty = draft.trim().length === 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider">
        <button
          type="button"
          onClick={() => setTab("edit")}
          className={`rounded px-2 py-0.5 transition ${
            tab === "edit"
              ? "bg-zinc-800 text-zinc-100"
              : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          edit
        </button>
        <button
          type="button"
          onClick={() => setTab("preview")}
          className={`rounded px-2 py-0.5 transition ${
            tab === "preview"
              ? "bg-zinc-800 text-zinc-100"
              : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          preview
        </button>
        <span className="ml-auto text-zinc-600">
          {status === "saving" ? "saving…" : note ? "saved" : isEmpty ? "" : "unsaved"}
        </span>
      </div>

      {tab === "edit" ? (
        <>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={handleBlur}
            placeholder="no notes yet — start typing markdown."
            className="min-h-[10rem] w-full resize-y rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 font-mono text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-700 focus:bg-zinc-900 focus:outline-none"
            spellCheck={false}
          />
          <p className="text-[10px] text-zinc-600">saves on blur. supports markdown.</p>
        </>
      ) : isEmpty ? (
        <p className="text-xs text-zinc-600">no notes yet.</p>
      ) : (
        <div
          className={`rounded-md border border-zinc-800 bg-zinc-900/30 px-3 py-2 ${NOTE_PROSE}`}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{draft}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}
