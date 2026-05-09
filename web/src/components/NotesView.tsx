import { useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "../lib/api";

interface Props {
  nodeId: string;
  /**
   * Initial display label for the preview / split view header — shown
   * immediately on mount before the GET `/note` round-trip resolves so the
   * user sees the title flash-free. Once the GET returns we switch to the
   * note's own `name` field (from `node_notes.name`, M6 phase 2). Both
   * sources are the same per-row at sidebar-click time; the fetched value
   * is preferred only because it's the canonical source of truth post-load
   * (e.g. after a rename in another tab).
   */
  title: string;
  /**
   * Initial editor mode (M6 phase 2). Defaults to `preview` for normal row
   * clicks. The inline-create flow passes `split` so the user lands in the
   * editor with the textarea focused, ready to type the body. Only honoured
   * once-per-mount — switching modes after that goes through the in-component
   * Edit / Done buttons.
   */
  initialMode?: "preview" | "split";
  /**
   * Bumped by the parent when the note body is saved so other surfaces that
   * depend on the note list (sidebar, dashboard recent-notes) re-fetch.
   */
  onChange: () => void;
}

const NOTE_PROSE = [
  "prose prose-invert prose-sm max-w-none",
  "prose-p:my-2 prose-p:leading-relaxed",
  "prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5",
  "prose-headings:text-zinc-100 prose-headings:font-medium",
  "prose-strong:text-zinc-100",
  "prose-em:text-zinc-200",
  "prose-a:text-sky-400 prose-a:no-underline hover:prose-a:underline",
  "prose-code:bg-zinc-900 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-zinc-200 prose-code:text-[0.85em] prose-code:font-mono prose-code:before:content-none prose-code:after:content-none",
  "prose-pre:bg-zinc-900 prose-pre:border prose-pre:border-zinc-800 prose-pre:rounded-lg prose-pre:my-3",
  "prose-blockquote:border-l-zinc-700 prose-blockquote:text-zinc-400",
  "prose-hr:border-zinc-800",
].join(" ");

type Mode = "preview" | "split";
type Status = "idle" | "loading" | "saving" | "error";

/**
 * Main-panel view for a selected note. Two modes:
 *
 * - `preview` — read-only `react-markdown` render with a header showing the
 *   node's display name and an `Edit` button top-right.
 * - `split` — textarea on the left, live preview on the right. Save-on-blur
 *   matches the per-node detail-panel editor in `GraphView`: the textarea's
 *   `onBlur` flushes the draft to the server when it diverges from the last
 *   confirmed body. No explicit save button.
 *
 * We re-fetch the note when `nodeId` changes so the same view instance can
 * cycle through different notes as the user clicks rows in the secondary
 * sidebar without remounting / blanking the main panel.
 */
export function NotesView({ nodeId, title, initialMode = "preview", onChange }: Props) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Note's own display label, sourced from `node_notes.name` once the GET
  // resolves. Falls back to the `title` prop (the sidebar's list-view name)
  // before the round-trip completes so the header doesn't flicker. Stays
  // null during the initial load → `title` is shown until the fetch lands.
  const [noteName, setNoteName] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);

  // Track the body the server last confirmed so blur is a no-op when nothing
  // changed (avoid an unnecessary PUT round-trip on every focus loss).
  const savedRef = useRef("");

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setError(null);
    // Reset to `initialMode` on nodeId change so the same view instance can
    // cycle through different notes without retaining the previous note's
    // mode. For the inline-create flow `initialMode` is `split` and stays
    // that way through this fetch; for normal row clicks it's `preview`.
    setMode(initialMode);
    setNoteName(null);
    api
      .getNote(nodeId)
      .then((res) => {
        if (cancelled) return;
        const body = res.note?.body ?? "";
        setDraft(body);
        savedRef.current = body;
        setNoteName(res.note?.name ?? null);
        setStatus("idle");
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
    // We intentionally key on `nodeId` only — `initialMode` is a per-mount
    // hint, and the parent re-mounts via `key={nodeId}` when switching notes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]);

  // Auto-focus the textarea once the note loads while in split mode. Covers
  // the inline-create flow (caller passes `initialMode="split"`) — the user
  // typed a name in the sidebar, pressed Enter, and lands here ready to type
  // the body without an extra click. Effect runs every time we transition
  // into split mode while idle; in practice that's once-per-mount for fresh
  // notes (status: loading → idle), and once-per-Edit-click for existing
  // notes (idle → idle, mode flip).
  useEffect(() => {
    if (mode !== "split" || status !== "idle") return;
    textareaRef.current?.focus();
  }, [mode, status]);

  // Flush any pending changes when this view unmounts mid-edit (notes view
  // closed, switched note, opened a chat). Ref-driven so we don't need to
  // wire deps through.
  const flushRef = useRef<() => Promise<void>>(async () => undefined);
  flushRef.current = async () => {
    if (draft === savedRef.current) return;
    try {
      await api.setNote(nodeId, draft);
      savedRef.current = draft.trim().length === 0 ? "" : draft;
      onChange();
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
      await api.setNote(nodeId, draft);
      savedRef.current = draft.trim().length === 0 ? "" : draft;
      setStatus("idle");
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }

  if (status === "loading") {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
        loading…
      </div>
    );
  }
  if (status === "error" && error) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-red-400">
        note error: {error}
      </div>
    );
  }

  const isEmpty = draft.trim().length === 0;

  if (mode === "preview") {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10 animate-fade-in">
        <header className="flex items-start justify-between gap-4">
          <h1 className="text-2xl font-medium tracking-tight text-zinc-100">
            {noteName ?? title}
          </h1>
          <button
            type="button"
            onClick={() => setMode("split")}
            className="flex shrink-0 items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 transition hover:border-zinc-700 hover:bg-zinc-900/80"
            aria-label="edit note"
          >
            <Pencil className="h-3 w-3" />
            Edit
          </button>
        </header>

        {isEmpty ? (
          <p className="text-sm text-zinc-500">
            no body yet — click <span className="text-zinc-300">Edit</span> to start
            writing.
          </p>
        ) : (
          <div className={`text-zinc-200 ${NOTE_PROSE}`}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{draft}</ReactMarkdown>
          </div>
        )}
      </div>
    );
  }

  // Split mode — editor + live preview.
  return (
    <div className="flex h-full min-h-0 flex-col animate-fade-in">
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-zinc-900/80 px-6 py-4">
        <h1 className="text-2xl font-medium tracking-tight text-zinc-100">{title}</h1>
        <div className="flex shrink-0 items-center gap-3">
          <span className="font-mono text-[10px] text-zinc-600">
            {status === "saving"
              ? "saving…"
              : draft === savedRef.current
                ? "saved"
                : "unsaved"}
          </span>
          <button
            type="button"
            onClick={() => {
              // Blur fires before the click handler in most browsers, but
              // belt-and-suspenders: flush manually too. `handleBlur` is a
              // no-op when nothing changed, so this is safe to chain.
              void handleBlur();
              setMode("preview");
            }}
            className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 transition hover:border-zinc-700 hover:bg-zinc-900/80"
          >
            Done
          </button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-2 divide-x divide-zinc-900/80">
        <div className="flex min-h-0 flex-col">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={handleBlur}
            placeholder="start typing markdown."
            className="h-full w-full resize-none bg-transparent px-6 py-6 font-mono text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
            spellCheck={false}
          />
        </div>
        <div className="min-h-0 overflow-y-auto px-6 py-6">
          {isEmpty ? (
            <p className="text-sm text-zinc-600">live preview appears here.</p>
          ) : (
            <div className={`text-zinc-200 ${NOTE_PROSE}`}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{draft}</ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
