import { useEffect, useState } from "react";
import { FileText, X } from "lucide-react";
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
  /** Click X (or click `Notes` in the primary sidebar again) to collapse. */
  onClose: () => void;
  /**
   * Bumped by the parent whenever the underlying note list might have
   * changed (note edited, new chat completed, etc.). The list re-fetches
   * on every change so the sidebar stays in sync.
   */
  refreshKey: number;
}

/**
 * Secondary sidebar that slides out to the right of the primary nav when
 * `Notes` is selected. Phase 2 is flat-list-only — folder hierarchy lands
 * in phase 3. Each row is a node-attached note (`KgNoteListEntry`); the
 * display label is the note's own `name` (M6 phase 2 — sourced from
 * `node_notes.name`, decoupled from the underlying node's name).
 */
export function NotesSidebar({
  selectedNoteId,
  onSelectNote,
  onClose,
  refreshKey,
}: Props) {
  const [notes, setNotes] = useState<KgNoteListEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r border-zinc-900/80 bg-zinc-950 animate-fade-in">
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-900/80 px-4 py-2.5">
        <FileText className="h-3.5 w-3.5 text-zinc-500" />
        <span className="text-[11px] uppercase tracking-wider text-zinc-500">notes</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="close notes"
          title="Close"
          className="ml-auto flex h-6 w-6 items-center justify-center rounded text-zinc-500 transition hover:bg-zinc-900 hover:text-zinc-200"
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {error ? (
          <p className="px-2 text-xs text-red-400">{error}</p>
        ) : !notes ? (
          <p className="px-2 text-xs text-zinc-600">loading…</p>
        ) : notes.length === 0 ? (
          <p className="px-2 text-xs text-zinc-600">
            no notes yet — open a node in the graph and add one.
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
