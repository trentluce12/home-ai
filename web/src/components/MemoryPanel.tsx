import { useState } from "react";
import { Brain, ChevronDown, ChevronRight } from "lucide-react";
import type { ContextEvent, DoneEvent, MemoryEvent, ToolEvent } from "../lib/api";

export function MemoryPanel({ events }: { events: MemoryEvent[] }) {
  const totals = computeTotals(events);
  return (
    <aside className="hidden lg:flex w-72 shrink-0 flex-col border-l border-zinc-900/80 overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-900/80 px-4 py-3">
        <Brain className="h-3.5 w-3.5 text-zinc-500" />
        <span className="text-xs uppercase tracking-wider text-zinc-500">memory</span>
        {events.length > 0 && (
          <span className="ml-auto text-xs text-zinc-600">{events.length}</span>
        )}
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {events.length === 0 ? (
          <p className="px-1 text-xs text-zinc-600">
            memory activity will show here as we chat.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {events.map((ev) => {
              if (ev.kind === "context")
                return <ContextEventCard key={ev.id} event={ev} />;
              if (ev.kind === "done") return <DoneEventCard key={ev.id} event={ev} />;
              return <ToolEventCard key={ev.id} event={ev} />;
            })}
          </ul>
        )}
      </div>
      {totals && (
        <div className="shrink-0 border-t border-zinc-900/80 px-4 py-2.5">
          <p className="font-mono text-[11px] text-zinc-500">
            <span className="text-zinc-300">{formatCost(totals.totalCostUsd)}</span>
            <span className="text-zinc-600"> · </span>
            <span>{formatTokens(totals.totalTokens)} tokens</span>
            <span className="text-zinc-600"> · </span>
            <span>{totals.cachedPct}% cached</span>
          </p>
        </div>
      )}
    </aside>
  );
}

function ContextEventCard({ event }: { event: ContextEvent }) {
  const [expanded, setExpanded] = useState(false);
  const summary =
    event.rootNames.length > 0
      ? event.rootNames.slice(0, 3).join(", ") + (event.rootNames.length > 3 ? "…" : "")
      : "no matches";
  const hasFormatted = event.formatted.length > 0;
  return (
    <li className="rounded-md border border-zinc-900 bg-zinc-900/30 animate-fade-in">
      <button
        type="button"
        onClick={() => hasFormatted && setExpanded((v) => !v)}
        disabled={!hasFormatted}
        className={`flex w-full items-center gap-1.5 px-2.5 py-2 text-left ${
          hasFormatted ? "cursor-pointer hover:bg-zinc-900/60" : "cursor-default"
        } rounded-md transition`}
      >
        {hasFormatted ? (
          expanded ? (
            <ChevronDown className="h-3 w-3 text-zinc-500" />
          ) : (
            <ChevronRight className="h-3 w-3 text-zinc-500" />
          )
        ) : (
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-sky-500" />
        )}
        <span className="font-mono text-xs text-zinc-300">context</span>
        <span className="ml-auto text-xs text-zinc-600">
          {event.nodeCount}n / {event.edgeCount}e
        </span>
      </button>
      <p className="px-2.5 pb-1.5 break-words text-xs text-zinc-500">{summary}</p>
      {expanded && hasFormatted && (
        <pre className="mx-2 mb-2 overflow-x-auto whitespace-pre-wrap break-words rounded border border-zinc-800 bg-zinc-950/60 px-2 py-1.5 font-mono text-[10px] leading-relaxed text-zinc-400">
          {event.formatted}
        </pre>
      )}
    </li>
  );
}

function ToolEventCard({ event }: { event: ToolEvent }) {
  const isKg = event.name.startsWith("mcp__kg__");
  const shortName = isKg ? event.name.slice("mcp__kg__".length) : event.name;
  const summary = summarizeInput(event.name, event.input);

  return (
    <li className="rounded-md border border-zinc-900 bg-zinc-900/30 px-2.5 py-2 animate-fade-in">
      <div className="flex items-center gap-1.5">
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full ${
            isKg ? "bg-emerald-500" : "bg-zinc-500"
          }`}
        />
        <span className="font-mono text-xs text-zinc-300">{shortName}</span>
      </div>
      {summary && <p className="mt-1 break-words text-xs text-zinc-500">{summary}</p>}
    </li>
  );
}

function DoneEventCard({ event }: { event: DoneEvent }) {
  const total =
    event.inputTokens +
    event.outputTokens +
    event.cacheReadTokens +
    event.cacheCreateTokens;
  const cachedPct = total > 0 ? Math.round((event.cacheReadTokens / total) * 100) : 0;
  return (
    <li className="px-2.5 py-1 animate-fade-in">
      <p className="font-mono text-[10px] text-zinc-600">
        {formatCost(event.totalCostUsd)} · {formatTokens(total)} tokens · {cachedPct}%
        cached
      </p>
    </li>
  );
}

function computeTotals(events: MemoryEvent[]): {
  totalCostUsd: number | null;
  totalTokens: number;
  cachedPct: number;
} | null {
  const dones = events.filter((e): e is DoneEvent => e.kind === "done");
  if (dones.length === 0) return null;
  let cost = 0;
  let costSeen = false;
  let total = 0;
  let cached = 0;
  for (const d of dones) {
    if (d.totalCostUsd !== null) {
      cost += d.totalCostUsd;
      costSeen = true;
    }
    total += d.inputTokens + d.outputTokens + d.cacheReadTokens + d.cacheCreateTokens;
    cached += d.cacheReadTokens;
  }
  return {
    totalCostUsd: costSeen ? cost : null,
    totalTokens: total,
    cachedPct: total > 0 ? Math.round((cached / total) * 100) : 0,
  };
}

function formatCost(usd: number | null): string {
  if (usd === null) return "—";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}k`;
}

function summarizeInput(name: string, input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const i = input as Record<string, unknown>;
  if (name === "mcp__kg__record_user_fact" || name === "mcp__kg__record_inferred_fact") {
    const a = i.a as { nameOrId?: string } | undefined;
    const b = i.b as { nameOrId?: string } | undefined;
    if (a?.nameOrId && b?.nameOrId) {
      return `${a.nameOrId} → ${b.nameOrId} [${i.edgeType ?? "?"}]`;
    }
  }
  if (name === "mcp__kg__search" && typeof i.query === "string") return `"${i.query}"`;
  if (name === "mcp__kg__get" && typeof i.id === "string") return i.id;
  if (name === "Bash" && typeof i.command === "string") {
    return i.command.length > 40 ? i.command.slice(0, 40) + "…" : i.command;
  }
  if (name === "Read" && typeof i.file_path === "string") return i.file_path;
  if (name === "WebSearch" && typeof i.query === "string") return `"${i.query}"`;
  if (name === "WebFetch" && typeof i.url === "string") return i.url;
  const json = JSON.stringify(input);
  return json.length > 60 ? json.slice(0, 60) + "…" : json;
}
