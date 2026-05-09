import { useCallback, useEffect, useRef, useState } from "react";
import { Brain, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import type { ContextEvent, DoneEvent, MemoryEvent, ToolEvent } from "../lib/api";

const MIN_WIDTH = 224; // tailwind w-56
const MAX_WIDTH = 384; // tailwind w-96
const DEFAULT_WIDTH = 288; // tailwind w-72
const STRIP_WIDTH = 32; // collapsed-state thin strip with expand button
const WIDTH_STORAGE_KEY = "home-ai:memory-panel:width";

interface Props {
  events: MemoryEvent[];
  /**
   * True when the panel area should be present at all (active chat with
   * messages — not the empty-state dashboard, not Notes view, not Graph
   * view). When false the aside collapses to width 0 with no border.
   */
  visible: boolean;
  /**
   * True when the user has clicked the collapse chevron. The panel area
   * is still visible (the thin expand strip stays clickable), the full
   * content is hidden. sessionStorage-persisted by the parent so the
   * collapse sticks for the rest of the tab session.
   */
  collapsed: boolean;
  /**
   * Toggles the collapsed state — flips the chevron-right (in the full
   * header) or chevron-left (in the collapsed strip) into its opposite.
   */
  onToggleCollapse: () => void;
}

// Persisted width is opportunistic: localStorage failures (Safari private
// mode, quota, disabled) fall back to the default and silently swallow
// write errors. Out-of-range stored values are clamped on read.
function loadWidth(): number {
  try {
    const raw = localStorage.getItem(WIDTH_STORAGE_KEY);
    if (raw === null) return DEFAULT_WIDTH;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n)) return DEFAULT_WIDTH;
    return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, n));
  } catch {
    return DEFAULT_WIDTH;
  }
}

function saveWidth(width: number): void {
  try {
    localStorage.setItem(WIDTH_STORAGE_KEY, String(width));
  } catch {
    // ignore — storage quotas / disabled storage shouldn't break the UI
  }
}

export function MemoryPanel({ events, visible, collapsed, onToggleCollapse }: Props) {
  const [width, setWidth] = useState<number>(() => loadWidth());
  const totals = computeTotals(events);

  // Persist after each change. Cheap (<1 write per drag-move on average)
  // and avoids losing the value if the user tabs away mid-drag.
  useEffect(() => {
    saveWidth(width);
  }, [width]);

  // Drag-to-resize. Captures the starting cursor X + width on mousedown,
  // attaches window-level move/up listeners (so the drag survives the
  // cursor briefly leaving the 4px handle hitbox), and clears them on
  // mouseup. Delta is inverted because the handle is on the LEFT edge:
  // dragging left grows the panel.
  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const onResizeMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      dragStateRef.current = { startX: e.clientX, startWidth: width };

      function onMove(ev: MouseEvent) {
        const start = dragStateRef.current;
        if (!start) return;
        const next = start.startWidth + (start.startX - ev.clientX);
        const clamped = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, next));
        setWidth(clamped);
      }
      function onUp() {
        dragStateRef.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      // Force the resize cursor + suppress text-selection across the whole
      // window while dragging — otherwise crossing into the chat panel's
      // text content flips the cursor and starts highlighting messages.
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [width],
  );

  const outerWidth = !visible ? 0 : collapsed ? STRIP_WIDTH : width;

  return (
    <aside
      className={`hidden lg:block shrink-0 overflow-hidden transition-[width] duration-150 ease-out ${
        visible ? "border-l border-zinc-900/80" : "pointer-events-none border-l-0"
      }`}
      style={{ width: outerWidth }}
      aria-hidden={!visible}
    >
      {visible && collapsed ? (
        // Collapsed strip — a thin column with a single expand button. Stays
        // clickable so the user can always get the panel back, unlike the
        // previous X-to-dismiss design.
        <div className="flex h-full w-8 flex-col items-center gap-3 py-3">
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label="expand memory panel"
            title="Expand memory"
            className="flex h-6 w-6 items-center justify-center rounded text-zinc-500 transition hover:bg-zinc-900 hover:text-zinc-200"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <Brain className="h-3.5 w-3.5 text-zinc-600" />
        </div>
      ) : (
        /* Full panel — inner shell holds a fixed width during the slide so
           the content doesn't reflow as the outer width transitions. The
           aside clips the overflow, giving a clean wipe-in from the right. */
        <div className="relative flex h-full flex-col" style={{ width }}>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="resize memory panel"
            onMouseDown={onResizeMouseDown}
            className="absolute left-0 top-0 z-10 h-full w-1 cursor-col-resize bg-transparent transition hover:bg-zinc-700/60"
          />
          <div className="flex shrink-0 items-center gap-2 border-b border-zinc-900/80 px-4 py-3">
            <Brain className="h-3.5 w-3.5 text-zinc-500" />
            <span className="text-xs uppercase tracking-wider text-zinc-500">memory</span>
            {events.length > 0 && (
              <span className="ml-auto text-xs text-zinc-600">{events.length}</span>
            )}
            <button
              type="button"
              onClick={onToggleCollapse}
              aria-label="collapse memory panel"
              title="Collapse"
              className={`flex h-6 w-6 items-center justify-center rounded text-zinc-500 transition hover:bg-zinc-900 hover:text-zinc-200 ${
                events.length > 0 ? "" : "ml-auto"
              }`}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
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
