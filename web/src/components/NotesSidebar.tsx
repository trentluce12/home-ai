import { useEffect, useRef, useState } from "react";
import { FileText, Plus, X } from "lucide-react";
import { api, type KgNoteListEntry } from "../lib/api";

interface Props {
  /**
   * The currently open note's `nodeId`, or `null` when the user is on the
   * notes-context dashboard variant. Drives the active-row highlight.
   */
  selectedNoteId: string | null;
  /**
   * Called when the user picks a note row. The display `name` is forwarded
   * so the parent can pass it to `NotesView` for the preview/split header
   * without a second round-trip. M6 phase 2: this is now the note's own
   * `name` (from `node_notes.name`), not the underlying node's name.
   */
  onSelectNote: (nodeId: string, name: string) => void;
  /**
   * Called when the inline-create flow successfully commits a new note.
   * The parent (a) bumps refreshKey so this sidebar re-fetches the list
   * (the new row was already optimistically rendered, but the canonical
   * order/preview comes from the server), (b) selects the new row, and
   * (c) tells `NotesView` to mount in split-edit mode so the user can
   * start typing the body immediately.
   */
  onCreateNote: (nodeId: string, name: string) => void;
  /** Click X (or click `Notes` in the primary sidebar again) to collapse. */
  onClose: () => void;
  /**
   * Bumped by the parent whenever the underlying note list might have
   * changed (note edited, new chat completed, etc.). The list re-fetches
   * on every change so the sidebar stays in sync.
   */
  refreshKey: number;
}

const UNTITLED_PLACEHOLDER = "untitled";

/**
 * Secondary sidebar that slides out to the right of the primary nav when
 * `Notes` is selected. Phase 2 is flat-list-only — folder hierarchy lands
 * in phase 3. Each row is a node-attached note (`KgNoteListEntry`); the
 * display label is the note's own `name` (M6 phase 2 — sourced from
 * `node_notes.name`, decoupled from the underlying node's name).
 *
 * The header `+` icon kicks off a VSCode-style inline-create flow: a new
 * row appears at the top of the list with an auto-focused textbox holding
 * the `untitled` placeholder. Enter or blur commits (POST `/api/kg/notes`,
 * mints a `Generic`-typed node + empty note in one transaction); Esc
 * cancels with no API call. On commit, the parent transitions the main
 * panel into split-edit mode for the new note (see `onCreateNote`).
 */
export function NotesSidebar({
  selectedNoteId,
  onSelectNote,
  onCreateNote,
  onClose,
  refreshKey,
}: Props) {
  const [notes, setNotes] = useState<KgNoteListEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Inline-create state. `null` = no row showing; non-null = the textbox is
  // open with the user's current draft. Submitting empties this and triggers
  // a list refresh; cancelling just empties this. We deliberately don't
  // optimistically prepend a fake row to `notes` — the refreshKey-driven
  // refetch after commit gives us the canonical row without bookkeeping a
  // local-vs-server divergence.
  const [draftName, setDraftName] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api
      .notes()
      .then((res) => {
        if (!cancelled) setNotes(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  // Auto-focus the inline-create input on open. Effect runs every time the
  // draft transitions from null → non-null (the open trigger); we then
  // select-all the placeholder so the user's first keystroke replaces it.
  useEffect(() => {
    if (draftName === null) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [draftName]);

  function handleStartCreate() {
    if (creating) return;
    setCreateError(null);
    setDraftName(UNTITLED_PLACEHOLDER);
  }

  function handleCancelCreate() {
    setDraftName(null);
    setCreateError(null);
  }

  async function handleCommitCreate() {
    if (creating) return;
    const trimmed = (draftName ?? "").trim();
    // Empty-or-placeholder commit cancels. The placeholder is what the input
    // pre-populates with, and the user can blur without typing — treat that
    // as "I changed my mind" rather than spawning an `untitled` node.
    if (!trimmed || trimmed === UNTITLED_PLACEHOLDER) {
      handleCancelCreate();
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const res = await api.createNote({ name: trimmed });
      setDraftName(null);
      onCreateNote(res.nodeId, res.name);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r border-zinc-900/80 bg-zinc-950 animate-fade-in">
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-900/80 px-4 py-2.5">
        <FileText className="h-3.5 w-3.5 text-zinc-500" />
        <span className="text-[11px] uppercase tracking-wider text-zinc-500">notes</span>
        <button
          type="button"
          onClick={handleStartCreate}
          aria-label="new note"
          title="New note"
          disabled={creating || draftName !== null}
          className="ml-auto flex h-6 w-6 items-center justify-center rounded text-zinc-500 transition hover:bg-zinc-900 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-zinc-500"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="close notes"
          title="Close"
          className="flex h-6 w-6 items-center justify-center rounded text-zinc-500 transition hover:bg-zinc-900 hover:text-zinc-200"
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {createError && (
          <p className="mb-2 px-2 text-xs text-red-400">create failed: {createError}</p>
        )}
        {draftName !== null && (
          // Inline-create row — sits at the top of the list while the
          // textbox is open. Mirrors the visual shape of a real note row so
          // the user reads it as "this is the new entry I'm naming."
          <div className="mb-0.5 flex w-full items-center gap-2 rounded-md bg-zinc-900 px-2 py-1.5">
            <FileText className="h-3.5 w-3.5 shrink-0 opacity-60" />
            <input
              ref={inputRef}
              type="text"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={() => {
                // Commit on blur — same as Enter. Cancel-on-Esc fires below
                // and clears `draftName` before blur lands, so this branch
                // doesn't double-commit on Esc.
                if (draftName !== null) void handleCommitCreate();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleCommitCreate();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  handleCancelCreate();
                }
              }}
              disabled={creating}
              className="min-w-0 flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none disabled:opacity-60"
              spellCheck={false}
              aria-label="new note name"
            />
          </div>
        )}

        {error ? (
          <p className="px-2 text-xs text-red-400">{error}</p>
        ) : !notes ? (
          <p className="px-2 text-xs text-zinc-600">loading…</p>
        ) : notes.length === 0 && draftName === null ? (
          <p className="px-2 text-xs text-zinc-600">
            no notes yet — click the <span className="text-zinc-300">+</span> to create
            one.
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {notes.map((n) => {
              const active = n.nodeId === selectedNoteId;
              return (
                <li key={n.nodeId}>
                  <button
                    type="button"
                    onClick={() => onSelectNote(n.nodeId, n.name)}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition ${
                      active
                        ? "bg-zinc-900 text-zinc-100"
                        : "text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-200"
                    }`}
                  >
                    <FileText className="h-3.5 w-3.5 shrink-0 opacity-60" />
                    <span className="flex-1 truncate">{n.name}</span>
                    <span className="shrink-0 text-[10px] text-zinc-600">{n.type}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
