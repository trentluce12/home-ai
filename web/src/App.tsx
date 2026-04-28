import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowUp } from "lucide-react";

type Message = { role: "user" | "assistant"; content: string };

const SERVER_URL = "http://localhost:3001";

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
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
    const newMessages = [...messages, userMessage];
    setMessages([...newMessages, { role: "assistant", content: "" }]);
    setInput("");
    setStreaming(true);

    try {
      const response = await fetch(`${SERVER_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages }),
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
            const payload = JSON.parse(line.slice(6));
            if (payload.type === "text") {
              setMessages((curr) => {
                const last = curr[curr.length - 1];
                if (!last) return curr;
                return [
                  ...curr.slice(0, -1),
                  { ...last, content: last.content + payload.delta },
                ];
              });
            } else if (payload.type === "error") {
              setError(payload.message);
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

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto flex h-full max-w-2xl flex-col px-6 py-10">
          {empty ? (
            <div className="flex flex-1 items-center justify-center">
              <div className="text-center animate-fade-in">
                <p className="text-3xl font-medium tracking-tight text-zinc-200">
                  hi.
                </p>
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
