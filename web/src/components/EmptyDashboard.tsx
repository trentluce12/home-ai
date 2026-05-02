import { useEffect, useState } from "react";
import { Download, ArrowRight, AlertTriangle, Trash2, Plus } from "lucide-react";
import {
  api,
  EDGE_TYPES,
  NODE_TYPES,
  type KgNode,
  type KgStats,
  type NodeWithNeighbors,
  type RecentEdge,
} from "../lib/api";

interface Props {
  refreshKey: number;
  onChange: () => void;
}

export function EmptyDashboard({ refreshKey, onChange }: Props) {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-10 animate-fade-in">
      <Hero />
      <StatsAndRecent refreshKey={refreshKey} />
      <AddFactForm onChange={onChange} />
      <ForgetForm onChange={onChange} />
      <ExportRow />
    </div>
  );
}

function Hero() {
  return (
    <div className="text-center">
      <p className="text-3xl font-medium tracking-tight text-zinc-200">hi.</p>
      <p className="mt-2 text-sm text-zinc-500">what's on your mind?</p>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className="text-xs uppercase tracking-wider text-zinc-500">{children}</span>
      <div className="h-px flex-1 bg-zinc-900" />
    </div>
  );
}

function StatsAndRecent({ refreshKey }: { refreshKey: number }) {
  const [stats, setStats] = useState<KgStats | null>(null);
  const [recent, setRecent] = useState<KgNode[] | null>(null);
  const [recentEdges, setRecentEdges] = useState<RecentEdge[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    Promise.all([api.stats(), api.recentNodes(8), api.recentEdges(6)])
      .then(([s, r, e]) => {
        if (cancelled) return;
        setStats(s);
        setRecent(r);
        setRecentEdges(e);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  if (error) {
    return <p className="text-center text-sm text-red-400">{error}</p>;
  }
  if (!stats || !recent || !recentEdges) return null;

  const types = Object.entries(stats.nodeCountsByType).sort((a, b) => b[1] - a[1]);

  return (
    <section>
      <SectionLabel>memory</SectionLabel>
      <div className="rounded-lg border border-zinc-900 bg-zinc-900/30 px-4 py-3">
        <div className="flex items-baseline gap-3">
          <span className="text-2xl font-medium text-zinc-100">{stats.nodeCount}</span>
          <span className="text-xs text-zinc-500">nodes</span>
          <span className="ml-2 text-2xl font-medium text-zinc-100">{stats.edgeCount}</span>
          <span className="text-xs text-zinc-500">edges</span>
        </div>
        {types.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500">
            {types.map(([type, count]) => (
              <span key={type}>
                <span className="text-zinc-400">{type}</span> {count}
              </span>
            ))}
          </div>
        )}
      </div>

      {recent.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs uppercase tracking-wider text-zinc-600">recent</p>
          <ul className="flex flex-col">
            {recent.map((n) => (
              <li
                key={n.id}
                className="flex items-baseline justify-between gap-2 border-b border-zinc-900/60 px-1 py-1.5 last:border-b-0"
              >
                <div className="min-w-0 truncate">
                  <span className="text-sm text-zinc-200">{n.name}</span>
                  <span className="ml-2 text-xs text-zinc-500">{n.type}</span>
                </div>
                <span className="font-mono text-[10px] text-zinc-600">
                  {timeAgo(n.updatedAt)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {recentEdges.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs uppercase tracking-wider text-zinc-600">
            recent connections
          </p>
          <ul className="flex flex-col">
            {recentEdges.map((e) => (
              <li
                key={e.id}
                className="flex items-baseline justify-between gap-2 border-b border-zinc-900/60 px-1 py-1.5 last:border-b-0"
              >
                <div className="min-w-0 truncate text-sm">
                  <span className="text-zinc-200">{e.from.name}</span>
                  <span className="mx-1.5 font-mono text-xs text-zinc-500">
                    {e.type}
                  </span>
                  <span className="text-zinc-200">{e.to.name}</span>
                </div>
                <span className="font-mono text-[10px] text-zinc-600">
                  {timeAgo(e.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function AddFactForm({ onChange }: { onChange: () => void }) {
  const [aName, setAName] = useState("user");
  const [aType, setAType] = useState<string>("Person");
  const [edgeType, setEdgeType] = useState<string>("OWNS");
  const [bName, setBName] = useState("");
  const [bType, setBType] = useState<string>("Pet");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!aName.trim() || !bName.trim()) return;
    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      await api.recordFact({
        a: { name: aName.trim(), type: aType },
        b: { name: bName.trim(), type: bType },
        edgeType,
      });
      setSuccess(`${aName} ${edgeType} ${bName}`);
      setBName("");
      onChange();
      setTimeout(() => setSuccess(null), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <section>
      <SectionLabel>add a fact</SectionLabel>
      <form
        onSubmit={submit}
        className="flex flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-3 transition focus-within:border-zinc-700"
      >
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={aName}
            onChange={(e) => setAName(e.target.value)}
            placeholder="a name"
            className="min-w-0 flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
          />
          <select
            value={aType}
            onChange={(e) => setAType(e.target.value)}
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300 focus:outline-none focus:border-zinc-600"
          >
            {NODE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={edgeType}
            onChange={(e) => setEdgeType(e.target.value)}
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono text-xs text-zinc-300 focus:outline-none focus:border-zinc-600"
          >
            {EDGE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="text"
            value={bName}
            onChange={(e) => setBName(e.target.value)}
            placeholder="b name"
            className="min-w-0 flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
          />
          <select
            value={bType}
            onChange={(e) => setBType(e.target.value)}
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300 focus:outline-none focus:border-zinc-600"
          >
            {NODE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={!aName.trim() || !bName.trim() || pending}
            className="flex h-7 items-center gap-1 rounded-full bg-zinc-100 px-3 text-xs text-zinc-900 transition hover:bg-white disabled:bg-zinc-800 disabled:text-zinc-600"
          >
            <Plus className="h-3 w-3" />
            {pending ? "saving…" : "add"}
          </button>
        </div>
      </form>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      {success && (
        <p className="mt-2 font-mono text-xs text-emerald-400">added: {success}</p>
      )}
    </section>
  );
}

function ForgetForm({ onChange }: { onChange: () => void }) {
  const [name, setName] = useState("");
  const [matches, setMatches] = useState<NodeWithNeighbors[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function findMatches() {
    if (!name.trim()) return;
    setError(null);
    setSearching(true);
    setMatches(null);
    try {
      const result = await api.byName(name.trim());
      setMatches(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSearching(false);
    }
  }

  async function forget(id: string) {
    setPending(id);
    try {
      await api.deleteNode(id);
      setMatches(null);
      setName("");
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(null);
    }
  }

  function reset() {
    setMatches(null);
    setName("");
    setError(null);
  }

  return (
    <section>
      <SectionLabel>forget a node</SectionLabel>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          findMatches();
        }}
        className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 transition focus-within:border-zinc-700"
      >
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="name to forget…"
          className="flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
        />
        <button
          type="submit"
          disabled={!name.trim() || searching}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-100 text-zinc-900 transition hover:bg-white disabled:bg-zinc-800 disabled:text-zinc-600"
          aria-label="find"
        >
          <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.5} />
        </button>
      </form>

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

      {matches && matches.length === 0 && (
        <p className="mt-3 text-sm text-zinc-500">no node named "{name}".</p>
      )}

      {matches && matches.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          <div className="flex items-start gap-2 rounded-md border border-amber-900/50 bg-amber-950/20 px-3 py-2 text-xs text-amber-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Forgetting a node also removes every edge attached to it. This cannot be
              undone.
            </span>
          </div>
          {matches.map(({ node, neighbors }) => (
            <div
              key={node.id}
              className="rounded-md border border-zinc-900 bg-zinc-900/30 px-3 py-2"
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <span className="text-sm text-zinc-200">{node.name}</span>
                  <span className="ml-2 text-xs text-zinc-500">{node.type}</span>
                </div>
                <button
                  onClick={() => forget(node.id)}
                  disabled={pending !== null}
                  className="flex items-center gap-1 rounded bg-red-950/50 px-2 py-1 text-xs text-red-300 transition hover:bg-red-900/60 disabled:opacity-50"
                >
                  <Trash2 className="h-3 w-3" />
                  {pending === node.id ? "forgetting…" : "forget"}
                </button>
              </div>
              {neighbors.length > 0 && (
                <ul className="mt-2 flex flex-col gap-0.5">
                  {neighbors.map((n) => (
                    <li key={n.edge.id} className="text-xs text-zinc-500">
                      · {n.edge.type} → {n.node.name} ({n.node.type})
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          <button
            onClick={reset}
            className="self-start text-xs text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline"
          >
            cancel
          </button>
        </div>
      )}
    </section>
  );
}

function ExportRow() {
  return (
    <section>
      <SectionLabel>export</SectionLabel>
      <p className="mb-3 text-xs text-zinc-500">
        Snapshot the knowledge graph. Embeddings are skipped — they're regenerable.
      </p>
      <div className="flex gap-2">
        <a
          href={api.exportUrl("json")}
          className="flex flex-1 items-center justify-center gap-2 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 transition hover:border-zinc-700 hover:bg-zinc-900/80"
        >
          <Download className="h-3.5 w-3.5" /> JSON
        </a>
        <a
          href={api.exportUrl("dot")}
          className="flex flex-1 items-center justify-center gap-2 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 transition hover:border-zinc-700 hover:bg-zinc-900/80"
        >
          <Download className="h-3.5 w-3.5" /> Graphviz (.dot)
        </a>
      </div>
    </section>
  );
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
