import { useEffect, useState } from "react";
import { Plus, Trash2, MessageSquare } from "lucide-react";
import { api, type SessionSummary } from "../lib/api";

interface Props {
  currentSessionId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  refreshKey: number;
}

export function SessionList({ currentSessionId, onSelect, onNew, refreshKey }: Props) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .listSessions()
      .then((s) => {
        if (!cancelled) setSessions(s);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  async function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm("Delete this conversation?")) return;
    try {
      await api.deleteSession(id);
      setSessions((s) => s.filter((x) => x.id !== id));
      if (id === currentSessionId) onNew();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <aside className="hidden lg:flex w-72 shrink-0 flex-col border-r border-zinc-900/80 overflow-hidden">
      <div className="flex shrink-0 items-center justify-between border-b border-zinc-900/80 px-4 py-3">
        <span className="text-xs uppercase tracking-wider text-zinc-500">chats</span>
        <button
          onClick={onNew}
          className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 transition hover:bg-zinc-900 hover:text-zinc-100"
          aria-label="new chat"
          title="New chat"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {loading && sessions.length === 0 ? (
          <p className="px-2 text-xs text-zinc-600">loading…</p>
        ) : error ? (
          <p className="px-2 text-xs text-red-400">{error}</p>
        ) : sessions.length === 0 ? (
          <p className="px-2 text-xs text-zinc-600">no chats yet.</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {sessions.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => onSelect(s.id)}
                  className={`group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition ${
                    s.id === currentSessionId
                      ? "bg-zinc-900 text-zinc-100"
                      : "text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-200"
                  }`}
                >
                  <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-60" />
                  <span className="flex-1 truncate">{s.title || "(untitled)"}</span>
                  <span
                    onClick={(e) => handleDelete(s.id, e)}
                    role="button"
                    className="hidden h-5 w-5 shrink-0 items-center justify-center rounded text-zinc-600 transition hover:bg-zinc-800 hover:text-zinc-300 group-hover:flex"
                    aria-label="delete chat"
                    title="Delete"
                  >
                    <Trash2 className="h-3 w-3" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
