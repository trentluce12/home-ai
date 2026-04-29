import { Brain } from "lucide-react";
import type { ContextEvent, MemoryEvent, ToolEvent } from "../lib/api";

export function MemoryPanel({ events }: { events: MemoryEvent[] }) {
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
            {events.map((ev) =>
              ev.kind === "context" ? (
                <ContextEventCard key={ev.id} event={ev} />
              ) : (
                <ToolEventCard key={ev.id} event={ev} />
              ),
            )}
          </ul>
        )}
      </div>
    </aside>
  );
}

function ContextEventCard({ event }: { event: ContextEvent }) {
  const summary =
    event.rootNames.length > 0
      ? event.rootNames.slice(0, 3).join(", ") +
        (event.rootNames.length > 3 ? "…" : "")
      : "no matches";
  return (
    <li className="rounded-md border border-zinc-900 bg-zinc-900/30 px-2.5 py-2 animate-fade-in">
      <div className="flex items-center gap-1.5">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-sky-500" />
        <span className="font-mono text-xs text-zinc-300">context</span>
        <span className="ml-auto text-xs text-zinc-600">
          {event.nodeCount}n / {event.edgeCount}e
        </span>
      </div>
      <p className="mt-1 break-words text-xs text-zinc-500">{summary}</p>
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
