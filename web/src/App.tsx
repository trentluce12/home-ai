import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowDown, ArrowUp, LogOut, Square } from "lucide-react";
import { MessageBubble } from "./components/MessageBubble";
import { MemoryPanel } from "./components/MemoryPanel";
import { Sidebar } from "./components/Sidebar";
import { EmptyDashboard } from "./components/EmptyDashboard";
import { GraphView } from "./components/GraphView";
import { Login } from "./components/Login";
import { ApprovalModal } from "./components/ApprovalModal";
import {
  api,
  SERVER_URL,
  type ApprovalRequest,
  type Message,
  type MemoryEvent,
} from "./lib/api";

const NEAR_BOTTOM_PX = 80;

type AuthState = "checking" | "anon" | "authed";

export default function App() {
  const [authState, setAuthState] = useState<AuthState>("checking");

  // One-shot probe on mount to decide whether to render <Login /> or the
  // full app shell. We treat any failure (network, 401, 5xx) as "anon" so
  // the user lands on the login screen rather than a stuck loading state.
  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then((res) => {
        if (!cancelled) setAuthState(res.authenticated ? "authed" : "anon");
      })
      .catch(() => {
        if (!cancelled) setAuthState("anon");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (authState === "checking") {
    // Brief loading state. A blank dark page for ~50ms is fine and won't
    // flash a login form before the cookie probe resolves.
    return <div className="h-dvh bg-zinc-950" />;
  }
  if (authState === "anon") {
    return <Login onSuccess={() => setAuthState("authed")} />;
  }
  return <ChatShell onLogout={() => setAuthState("anon")} />;
}

function ChatShell({ onLogout }: { onLogout: () => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [memoryEvents, setMemoryEvents] = useState<MemoryEvent[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [graphOpen, setGraphOpen] = useState(false);
  // When the dashboard "notes" panel opens the graph, it passes the node ID
  // so GraphView can focus + populate its detail panel automatically. Reset
  // to null on close so a subsequent toolbar-button open doesn't re-focus.
  const [graphFocusNodeId, setGraphFocusNodeId] = useState<string | null>(null);
  const [showJumpPill, setShowJumpPill] = useState(false);
  const [approvalRequest, setApprovalRequest] = useState<ApprovalRequest | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const stickToBottomRef = useRef(true);

  function isNearBottom(el: HTMLElement): boolean {
    return el.scrollHeight - el.clientHeight - el.scrollTop <= NEAR_BOTTOM_PX;
  }

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
      setShowJumpPill(false);
    } else {
      setShowJumpPill(true);
    }
  }, [messages]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const near = isNearBottom(el);
    stickToBottomRef.current = near;
    if (near) setShowJumpPill(false);
  }

  function jumpToLatest() {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    stickToBottomRef.current = true;
    setShowJumpPill(false);
  }

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [input]);

  function handleNewChat() {
    if (streaming) abortRef.current?.abort();
    setMessages([]);
    setMemoryEvents([]);
    setSessionId(null);
    setError(null);
    setInput("");
    setApprovalRequest(null);
    stickToBottomRef.current = true;
    setShowJumpPill(false);
  }

  async function handleSelectSession(id: string) {
    if (id === sessionId || streaming) return;
    setError(null);
    setMemoryEvents([]);
    try {
      const history = await api.sessionHistory(id);
      setMessages(history);
      setSessionId(id);
      stickToBottomRef.current = true;
      setShowJumpPill(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  async function send() {
    const trimmed = input.trim();
    if (!trimmed || streaming) return;

    setError(null);
    const userMessage: Message = { role: "user", content: trimmed };
    setMessages((curr) => [...curr, userMessage, { role: "assistant", content: "" }]);
    setInput("");
    setStreaming(true);
    stickToBottomRef.current = true;

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch(`${SERVER_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ message: trimmed, sessionId }),
        signal: controller.signal,
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
      if (controller.signal.aborted) {
        // User-initiated stop — keep partial text, no error banner.
      } else {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    } finally {
      abortRef.current = null;
      setStreaming(false);
      setRefreshKey((k) => k + 1);
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
            formatted: (payload.formatted as string) ?? "",
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
      case "approval_request": {
        const requestId = payload.requestId;
        const kind = payload.kind;
        if (typeof requestId === "string" && typeof kind === "string") {
          setApprovalRequest({
            requestId,
            kind,
            payload: payload.payload,
          });
        }
        break;
      }
      case "done": {
        const usage =
          (payload.usage as
            | {
                input_tokens?: number;
                output_tokens?: number;
                cache_read_input_tokens?: number;
                cache_creation_input_tokens?: number;
              }
            | undefined) ?? {};
        setMemoryEvents((curr) => [
          ...curr,
          {
            kind: "done",
            id: crypto.randomUUID(),
            totalCostUsd: (payload.totalCostUsd as number | null) ?? null,
            inputTokens: usage.input_tokens ?? 0,
            outputTokens: usage.output_tokens ?? 0,
            cacheReadTokens: usage.cache_read_input_tokens ?? 0,
            cacheCreateTokens: usage.cache_creation_input_tokens ?? 0,
          },
        ]);
        break;
      }
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

  async function handleLogout() {
    if (streaming) abortRef.current?.abort();
    try {
      await api.logout();
    } catch {
      // The cookie may have already expired server-side; either way we
      // drop the user back to the login screen so they can re-auth.
    }
    onLogout();
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
        <div className="flex items-center gap-3">
          {streaming && (
            <span className="text-xs text-zinc-500 animate-pulse">thinking…</span>
          )}
          <button
            onClick={handleLogout}
            aria-label="log out"
            title="Log out"
            className="flex h-7 w-7 items-center justify-center rounded text-zinc-400 transition hover:bg-zinc-900 hover:text-zinc-100"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <Sidebar
          currentSessionId={sessionId}
          onSelectSession={handleSelectSession}
          onNewChat={handleNewChat}
          refreshKey={refreshKey}
          onOpenGraph={() => setGraphOpen(true)}
          onOpenNotes={() => {
            // Notes view lands in m6p2; this is a no-op placeholder so the
            // button is wired and keyboard-discoverable in phase 1.
            alert("Notes view coming in phase 2.");
          }}
        />

        <main
          ref={scrollRef}
          onScroll={onScroll}
          className="relative flex-1 overflow-y-auto"
        >
          <div className="mx-auto flex h-full max-w-2xl flex-col px-6 py-10">
            {empty ? (
              <EmptyDashboard
                refreshKey={refreshKey}
                onChange={() => setRefreshKey((k) => k + 1)}
                onOpenNode={(id) => {
                  setGraphFocusNodeId(id);
                  setGraphOpen(true);
                }}
              />
            ) : (
              <div className="flex flex-col gap-6">
                {messages.map((m, i) => (
                  <MessageBubble key={i} message={m} />
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
          {showJumpPill && !empty && (
            <button
              onClick={jumpToLatest}
              aria-label="jump to latest"
              className="sticky bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/90 px-3 py-1.5 text-xs text-zinc-300 shadow-lg backdrop-blur transition hover:border-zinc-700 hover:bg-zinc-900"
            >
              <ArrowDown className="h-3 w-3" />
              jump to latest
            </button>
          )}
        </main>

        <MemoryPanel events={memoryEvents} />
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
            {streaming ? (
              <button
                onClick={stop}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-900 transition hover:bg-white"
                aria-label="stop"
                title="Stop"
              >
                <Square className="h-3.5 w-3.5" strokeWidth={2.5} fill="currentColor" />
              </button>
            ) : (
              <button
                onClick={send}
                disabled={!input.trim()}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-900 transition hover:bg-white disabled:bg-zinc-800 disabled:text-zinc-600"
                aria-label="send"
              >
                <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
              </button>
            )}
          </div>
          <p className="mt-2 text-center text-xs text-zinc-600">
            {streaming
              ? "click stop to interrupt"
              : "enter to send · shift + enter for newline"}
          </p>
        </div>
      </footer>

      <GraphView
        open={graphOpen}
        onClose={() => {
          setGraphOpen(false);
          setGraphFocusNodeId(null);
        }}
        refreshKey={refreshKey}
        initialNodeId={graphFocusNodeId}
      />

      {approvalRequest && (
        <ApprovalModal
          request={approvalRequest}
          onResolved={() => setApprovalRequest(null)}
        />
      )}
    </div>
  );
}
