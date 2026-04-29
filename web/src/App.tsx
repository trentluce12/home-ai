import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowUp, Brain } from "lucide-react";

type Message = { role: "user" | "assistant"; content: string };
type ToolEvent = {
  kind: "tool";
  id: string;
  name: string;
  input: unknown;
};
type ContextEvent = {
  kind: "context";
  id: string;
  nodeCount: number;
  edgeCount: number;
  rootNames: string[];
};
type MemoryEvent = ToolEvent | ContextEvent;

const SERVER_URL = "http://localhost:3001";

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [memoryEvents, setMemoryEvents] = useState<MemoryEvent[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
  }, [messages]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [input]);

  async function send() {
    const trimmed = input.trim();
    if (!trimmed || streaming) return;

    setError(null);
    const userMessage: Message = { role: "user", content: trimmed };
    setMessages((curr) => [...curr, userMessage, { role: "assistant", content: "" }]);
    setInput("");
    setStreaming(true);

    try {
      const response = await fetch(`${SERVER_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, sessionId }),
      });

      if (!response.ok || !response.body) {
        throw new Error(`Request failed (${response.status})`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const event of events) {
          for (const line of event.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            try {
              const payload = JSON.parse(line.slice(6));
              handleEvent(payload);
            } catch {
              // ignore malformed events
            }
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setStreaming(false);
    }
  }

  function handleEvent(payload: { type: string; [k: string]: unknown }) {
    switch (payload.type) {
      case "session":
        if (typeof payload.id === "string") setSessionId(payload.id);
        break;
      case "text":
        setMessages((curr) => {
          const last = curr[curr.length - 1];
          if (!last) return curr;
          return [
            ...curr.slice(0, -1),
            { ...last, content: last.content + (payload.delta as string) },
          ];
        });
        break;
      case "context":
        setMemoryEvents((curr) => [
          ...curr,
          {
            kind: "context",
            id: crypto.randomUUID(),
            nodeCount: (payload.nodeCount as number) ?? 0,
            edgeCount: (payload.edgeCount as number) ?? 0,
            rootNames: (payload.rootNames as string[]) ?? [],
          },
        ]);
        break;
      case "tool_use":
        setMemoryEvents((curr) => [
          ...curr,
          {
            kind: "tool",
            id: (payload.id as string) ?? crypto.randomUUID(),
            name: payload.name as string,
            input: payload.input,
          },
        ]);
        break;
      case "error":
        setError(payload.message as string);
        break;
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const empty = messages.length === 0;

  return (
    <div className="flex h-dvh flex-col bg-zinc-950 text-zinc-100 font-sans">
      <header className="flex shrink-0 items-center justify-between border-b border-zinc-900/80 px-6 py-4">
        <div className="flex items-baseline gap-1.5 font-mono text-sm tracking-tight">
          <span className="text-zinc-100">home</span>
          <span className="text-zinc-600">·</span>
          <span className="text-zinc-500">ai</span>
        </div>
        {streaming && (
          <span className="text-xs text-zinc-500 animate-pulse">thinking…</span>
        )}
      </header>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto flex h-full max-w-2xl flex-col px-6 py-10">
            {empty ? (
              <div className="flex flex-1 items-center justify-center">
                <div className="text-center animate-fade-in">
                  <p className="text-3xl font-medium tracking-tight text-zinc-200">hi.</p>
                  <p className="mt-2 text-sm text-zinc-500">what's on your mind?</p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-6">
                {messages.map((m, i) => (
                  <MessageBubble
                    key={i}
                    message={m}
                    isStreamingTail={
                      streaming && i === messages.length - 1 && m.role === "assistant"
                    }
                  />
                ))}
                {error && (
                  <div className="rounded-lg border border-red-900/60 bg-red-950/30 px-4 py-2.5 text-sm text-red-300 animate-fade-in">
                    {error}
                  </div>
                )}
                <div ref={bottomRef} />
              </div>
            )}
          </div>
        </main>

        <aside className="hidden lg:flex w-72 shrink-0 flex-col border-l border-zinc-900/80 overflow-hidden">
          <div className="flex shrink-0 items-center gap-2 border-b border-zinc-900/80 px-4 py-3">
            <Brain className="h-3.5 w-3.5 text-zinc-500" />
            <span className="text-xs uppercase tracking-wider text-zinc-500">memory</span>
            {memoryEvents.length > 0 && (
              <span className="ml-auto text-xs text-zinc-600">{memoryEvents.length}</span>
            )}
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-3">
            {memoryEvents.length === 0 ? (
              <p className="px-1 text-xs text-zinc-600">
                memory activity will show here as we chat.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {memoryEvents.map((ev) =>
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
      </div>

      <footer className="shrink-0 border-t border-zinc-900/80 px-6 py-4">
        <div className="mx-auto max-w-2xl">
          <div className="relative flex items-end gap-2 rounded-2xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 backdrop-blur transition-colors focus-within:border-zinc-700 focus-within:bg-zinc-900">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="message home-ai…"
              rows={1}
              className="flex-1 resize-none bg-transparent text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
            />
            <button
              onClick={send}
              disabled={streaming || !input.trim()}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-900 transition hover:bg-white disabled:bg-zinc-800 disabled:text-zinc-600"
              aria-label="send"
            >
              <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
            </button>
          </div>
          <p className="mt-2 text-center text-xs text-zinc-600">
            enter to send · shift + enter for newline
          </p>
        </div>
      </footer>
    </div>
  );
}

function MessageBubble({
  message,
  isStreamingTail,
}: {
  message: Message;
  isStreamingTail: boolean;
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end animate-fade-in">
        <div className="max-w-[85%] rounded-2xl bg-zinc-900 px-4 py-2.5 text-zinc-100">
          {message.content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start animate-fade-in">
      <div className="max-w-[85%] whitespace-pre-wrap leading-relaxed text-zinc-200">
        {message.content}
        {isStreamingTail && (
          <span className="ml-0.5 inline-block h-4 w-1.5 -translate-y-px animate-pulse bg-zinc-400 align-middle" />
        )}
      </div>
    </div>
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
      {summary && (
        <p className="mt-1 break-words text-xs text-zinc-500">{summary}</p>
      )}
    </li>
  );
}

function summarizeInput(name: string, input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const i = input as Record<string, unknown>;
  if (name === "mcp__kg__link") {
    const a = i.a as { nameOrId?: string } | undefined;
    const b = i.b as { nameOrId?: string } | undefined;
    if (a?.nameOrId && b?.nameOrId) {
      return `${a.nameOrId} → ${b.nameOrId} [${i.edgeType ?? "?"}]`;
    }
  }
  if (name === "mcp__kg__search" && typeof i.query === "string") return `"${i.query}"`;
  if (name === "mcp__kg__add_node" && typeof i.name === "string") {
    return `${i.type ?? "?"} "${i.name}"`;
  }
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
