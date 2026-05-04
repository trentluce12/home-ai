import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Plus,
  X,
} from "lucide-react";
import { api, type KgNoteListEntry, type NoteFolder } from "../lib/api";

interface Props {
  /**
   * The currently open note's `nodeId`, or `null` when the user is on the
   * notes-context dashboard variant. Drives the active-row highlight.
   */
  selectedNoteId: string | null;
  /**
   * Called when the user picks a note row. The display `name` is forwarded
   * so the parent can pass it to `NotesView` for the preview/split header
   * without a second round-trip.
   */
  onSelectNote: (nodeId: string, name: string) => void;
  /**
   * Called when the inline-create flow successfully commits a new note.
   * The parent (a) bumps refreshKey so other surfaces re-fetch, (b) selects
   * the new row, and (c) tells `NotesView` to mount in split-edit mode so
   * the user can start typing the body immediately.
   */
  onCreateNote: (nodeId: string, name: string) => void;
  /**
   * Called after a note's name is changed via the right-click `Rename`
   * action (M6 phase 3). Lets the parent update `selectedNote.name` if it
   * matches the renamed note, and bump `refreshKey` so the dashboard's
   * recent-notes panel picks up the new label.
   */
  onNoteRenamed: (nodeId: string, newName: string) => void;
  /**
   * Called after a note is deleted via the right-click `Delete` action
   * (M6 phase 3). Lets the parent clear `selectedNote` if the deleted note
   * was active, plus bump `refreshKey`.
   */
  onNoteDeleted: (nodeId: string) => void;
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
const EXPANDED_STORAGE_KEY = "home-ai:notes-sidebar:expanded";

/**
 * Shape of an inline-edit slot. Only one is active at a time. `kind` picks
 * the verb, the rest of the fields are context for the commit handler.
 */
type EditState =
  | { kind: "create-folder"; parentId: number | null; draft: string }
  | { kind: "create-note"; parentId: number | null; draft: string }
  | { kind: "rename-folder"; folderId: number; draft: string }
  | { kind: "rename-note"; nodeId: string; draft: string };

/**
 * Custom right-click menu state. `target` describes what the user
 * right-clicked, which controls which menu items render.
 */
type MenuTarget =
  | { kind: "folder"; folder: NoteFolder }
  | { kind: "note"; note: KgNoteListEntry }
  | { kind: "empty" };

interface MenuState {
  x: number;
  y: number;
  target: MenuTarget;
}

interface DeletePromptState {
  folder: NoteFolder;
  noteCount: number;
  subfolderCount: number;
}

/**
 * Drag-and-drop source: what the user is currently dragging. We track the
 * row's current parent so a drop onto the same parent short-circuits to a
 * no-op (no API round-trip, no flicker).
 */
type DragSource =
  | { kind: "note"; nodeId: string; currentFolderId: number | null }
  | { kind: "folder"; folderId: number; currentParentId: number | null };

/**
 * Drop target highlighted under the cursor. `root` is the top-of-sidebar
 * "Unfiled" zone (un-files the dragged row). `folder` is any folder header.
 */
type DropTarget = { kind: "folder"; folderId: number } | { kind: "root" };

/**
 * Spring-loaded folder expansion delay. VSCode uses ~500ms; we round up to
 * 600ms so it doesn't fire on a glance-pass over a folder.
 */
const SPRING_LOAD_MS = 600;
/** Duration the rejection toast stays on screen. */
const DRAG_TOAST_MS = 2500;
/** Length of the shake animation (matches the `shake` keyframe in tailwind.config.ts). */
const SHAKE_MS = 350;

/**
 * Tree-assembly intermediate. Folders nest into `subfolders`; notes whose
 * `folderId` matches the folder's id slot into `notes`. Sorted siblings
 * are in stable order: folders by `sortOrder` then `name`; notes by the
 * server's already-applied recency order (we just preserve it).
 */
interface TreeFolder {
  folder: NoteFolder;
  subfolders: TreeFolder[];
  notes: KgNoteListEntry[];
}

interface Tree {
  rootFolders: TreeFolder[];
  rootNotes: KgNoteListEntry[];
}

function loadExpanded(): Set<number> {
  try {
    const raw = localStorage.getItem(EXPANDED_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    const ids: number[] = [];
    for (const v of parsed) {
      if (typeof v === "number" && Number.isInteger(v)) ids.push(v);
    }
    return new Set(ids);
  } catch {
    return new Set();
  }
}

function saveExpanded(expanded: Set<number>): void {
  try {
    localStorage.setItem(EXPANDED_STORAGE_KEY, JSON.stringify([...expanded]));
  } catch {
    // ignore — localStorage failures shouldn't break tree toggling
  }
}

/**
 * Assemble the flat folder + note arrays into a nested tree. Folders not
 * reachable from any root (orphan parent ids — shouldn't happen normally,
 * but defensive against cascading deletes mid-fetch) are silently dropped.
 */
function buildTree(folders: NoteFolder[], notes: KgNoteListEntry[]): Tree {
  const byParent = new Map<number | null, NoteFolder[]>();
  for (const f of folders) {
    const arr = byParent.get(f.parentId);
    if (arr) arr.push(f);
    else byParent.set(f.parentId, [f]);
  }
  // Stable sort by sortOrder asc, then name asc, for sibling display.
  for (const arr of byParent.values()) {
    arr.sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.name.localeCompare(b.name);
    });
  }

  const notesByFolder = new Map<number | null, KgNoteListEntry[]>();
  for (const n of notes) {
    const arr = notesByFolder.get(n.folderId);
    if (arr) arr.push(n);
    else notesByFolder.set(n.folderId, [n]);
  }
  // The API already orders notes by recency; we preserve that within each
  // folder bucket since iteration above is in input order.

  function build(parentId: number | null): TreeFolder[] {
    const children = byParent.get(parentId) ?? [];
    return children.map((f) => ({
      folder: f,
      subfolders: build(f.id),
      notes: notesByFolder.get(f.id) ?? [],
    }));
  }

  return {
    rootFolders: build(null),
    rootNotes: notesByFolder.get(null) ?? [],
  };
}

/**
 * Count notes (recursive) and subfolders (recursive, excluding self) under a
 * folder. Used by the non-empty-delete prompt copy.
 */
function countDescendants(
  folder: NoteFolder,
  folders: NoteFolder[],
  notes: KgNoteListEntry[],
): { noteCount: number; subfolderCount: number } {
  const subfolderIds = new Set<number>();
  function walkFolders(parentId: number) {
    for (const f of folders) {
      if (f.parentId === parentId) {
        subfolderIds.add(f.id);
        walkFolders(f.id);
      }
    }
  }
  walkFolders(folder.id);

  let noteCount = 0;
  for (const n of notes) {
    if (
      n.folderId === folder.id ||
      (n.folderId !== null && subfolderIds.has(n.folderId))
    ) {
      noteCount += 1;
    }
  }
  return { noteCount, subfolderCount: subfolderIds.size };
}

/**
 * Secondary sidebar that slides out to the right of the primary nav when
 * `Notes` is selected. M6 phase 3: renders a folder tree assembled from the
 * flat folder + note lists (`api.listFolders` / `api.notes`). Top-level
 * supports a custom right-click context menu, inline-edit creation /
 * rename, and a non-empty-delete prompt for folders.
 *
 * Tree expansion state persists across sessions via `localStorage`. Top-level
 * folders default to expanded on first load (matching the design log's
 * "top-level expanded by default; deeper levels collapsed" rule); subsequent
 * opens honor whatever the user set.
 */
export function NotesSidebar({
  selectedNoteId,
  onSelectNote,
  onCreateNote,
  onNoteRenamed,
  onNoteDeleted,
  onClose,
  refreshKey,
}: Props) {
  const [notes, setNotes] = useState<KgNoteListEntry[] | null>(null);
  const [folders, setFolders] = useState<NoteFolder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Single inline-edit slot. Null means no edit row is open. We track it
  // separately from the tree data so a refetch doesn't blow away the user's
  // in-progress draft.
  const [edit, setEdit] = useState<EditState | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [deletePrompt, setDeletePrompt] = useState<DeletePromptState | null>(null);
  // Expanded folder ids. Loaded once from localStorage on mount; persisted
  // on every change. Default: empty set, but we seed with all *root* folder
  // ids the first time we see them so the top level is expanded by default.
  const [expanded, setExpanded] = useState<Set<number>>(() => loadExpanded());
  const seededDefaultExpansion = useRef(false);

  // Drag-and-drop state. `drag` is what's currently being dragged; `dropTarget`
  // is the highlighted folder (or root zone) under the cursor. `shakeFolderId`
  // flags a folder to play the rejection animation on. `dragToast` is the
  // brief inline toast describing why a drop was rejected.
  const [drag, setDrag] = useState<DragSource | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [shakeFolderId, setShakeFolderId] = useState<number | null>(null);
  const [dragToast, setDragToast] = useState<string | null>(null);
  // Timers we own — cleared on transitions and on unmount. Storing them in
  // refs avoids re-render churn that would happen if they lived in state.
  const springLoadedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  // Persist expanded state on every change. Cheap (a Set of small numbers
  // serialized to JSON) and the user's tree shape doesn't churn rapidly.
  useEffect(() => {
    saveExpanded(expanded);
  }, [expanded]);

  // Combined load — folders + notes in parallel. We refetch on `refreshKey`
  // (parent signal: chat finished, note edited, etc.) and also locally after
  // any folder/note CRUD op via the `reload` callback below.
  const loadAll = useCallback(async () => {
    setError(null);
    try {
      const [foldersRes, notesRes] = await Promise.all([api.listFolders(), api.notes()]);
      setFolders(foldersRes);
      setNotes(notesRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll, refreshKey]);

  // First-load default expansion — seed with all current root folder ids,
  // but only if localStorage didn't already persist a choice. Once the user
  // collapses or expands anything we trust their state.
  useEffect(() => {
    if (folders === null) return;
    if (seededDefaultExpansion.current) return;
    seededDefaultExpansion.current = true;
    try {
      const stored = localStorage.getItem(EXPANDED_STORAGE_KEY);
      if (stored !== null) return; // user has a saved state already
    } catch {
      // ignore
    }
    const rootIds = folders.filter((f) => f.parentId === null).map((f) => f.id);
    if (rootIds.length === 0) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const id of rootIds) next.add(id);
      return next;
    });
  }, [folders]);

  // Stable identity of the current edit slot — `kind` plus the relevant
  // target id. Lets the auto-focus effect fire only when the *slot itself*
  // changes (open / close / switch), not on every keystroke. Without this,
  // the effect would re-run on each `setEdit({...prev, draft})` and call
  // `el.select()` after every char, which selects-all and makes typing
  // reset on the next keystroke.
  const editIdentity = edit
    ? edit.kind === "rename-folder"
      ? `rename-folder:${edit.folderId}`
      : edit.kind === "rename-note"
        ? `rename-note:${edit.nodeId}`
        : `${edit.kind}:${edit.parentId ?? "root"}`
    : null;

  // Auto-focus the inline-edit input when an edit slot opens. Effect runs on
  // every transition into a different non-null edit identity; we select-all
  // so the user's first keystroke replaces the placeholder/current name.
  useEffect(() => {
    if (editIdentity === null) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [editIdentity]);

  // Close the context menu on Esc, scroll, resize, or any click that isn't
  // on the menu itself. Mirrors how OS-level context menus behave.
  useEffect(() => {
    if (menu === null) return;
    function close() {
      setMenu(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const tree = useMemo(() => {
    if (folders === null || notes === null) return null;
    return buildTree(folders, notes);
  }, [folders, notes]);

  // Precompute the set of folder ids that are descendants of the currently
  // dragged folder. Used by the row's `onDragOver` to suppress the drop
  // highlight (and the drop itself) on invalid targets, so the cursor shows
  // the no-drop icon and the row doesn't visually accept the drop. Empty
  // set when the user is dragging a note (no cycle concern) or not dragging.
  const descendantsOfDrag = useMemo(() => {
    if (drag === null || drag.kind !== "folder" || folders === null) {
      return new Set<number>();
    }
    const out = new Set<number>();
    const stack = [drag.folderId];
    while (stack.length > 0) {
      const id = stack.pop();
      if (id === undefined) break;
      for (const f of folders) {
        if (f.parentId === id && !out.has(f.id)) {
          out.add(f.id);
          stack.push(f.id);
        }
      }
    }
    return out;
  }, [drag, folders]);

  function toggleExpanded(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ─── Drag-and-drop ────────────────────────────────────────────────────

  /**
   * Set / clear the inline rejection toast. The toast is purely informational
   * — the drop has already been refused at this point. Auto-dismisses after
   * `DRAG_TOAST_MS` so the user isn't left with a stale message after a few
   * unrelated clicks.
   */
  const showDragToast = useCallback((message: string) => {
    setDragToast(message);
    if (dragToastTimerRef.current !== null) clearTimeout(dragToastTimerRef.current);
    dragToastTimerRef.current = setTimeout(() => {
      setDragToast(null);
      dragToastTimerRef.current = null;
    }, DRAG_TOAST_MS);
  }, []);

  /**
   * Trigger the shake animation on a folder row. The CSS animation runs once
   * (it's not infinite); we clear `shakeFolderId` after the duration so a
   * subsequent rejection on the same folder re-triggers the animation
   * (without the clear, React would skip the re-render of the same value).
   */
  const triggerShake = useCallback((folderId: number) => {
    setShakeFolderId(folderId);
    if (shakeTimerRef.current !== null) clearTimeout(shakeTimerRef.current);
    shakeTimerRef.current = setTimeout(() => {
      setShakeFolderId(null);
      shakeTimerRef.current = null;
    }, SHAKE_MS);
  }, []);

  /**
   * Clear all drag-derived UI state. Called on dragend (always fires, even
   * after a successful drop) and after a successful drop's API call resolves.
   */
  const clearDragState = useCallback(() => {
    setDrag(null);
    setDropTarget(null);
    if (springLoadedTimerRef.current !== null) {
      clearTimeout(springLoadedTimerRef.current);
      springLoadedTimerRef.current = null;
    }
  }, []);

  // Spring-loaded folder expansion: while a drag is hovering a collapsed
  // folder, expand it after `SPRING_LOAD_MS` so the user can reach nested
  // drop targets without clicking-to-expand first. The effect re-runs on
  // every dropTarget change, so moving the cursor between folders restarts
  // the timer cleanly.
  useEffect(() => {
    if (springLoadedTimerRef.current !== null) {
      clearTimeout(springLoadedTimerRef.current);
      springLoadedTimerRef.current = null;
    }
    if (dropTarget === null || dropTarget.kind !== "folder") return;
    const folderId = dropTarget.folderId;
    if (expanded.has(folderId)) return;
    springLoadedTimerRef.current = setTimeout(() => {
      springLoadedTimerRef.current = null;
      setExpanded((prev) => {
        if (prev.has(folderId)) return prev;
        const next = new Set(prev);
        next.add(folderId);
        return next;
      });
    }, SPRING_LOAD_MS);
    return () => {
      if (springLoadedTimerRef.current !== null) {
        clearTimeout(springLoadedTimerRef.current);
        springLoadedTimerRef.current = null;
      }
    };
  }, [dropTarget, expanded]);

  // Cleanup any straggling timers on unmount so we don't fire setState into
  // an unmounted component (rare in practice — the sidebar lives as long as
  // the user's session — but defensive).
  useEffect(() => {
    return () => {
      if (springLoadedTimerRef.current !== null)
        clearTimeout(springLoadedTimerRef.current);
      if (dragToastTimerRef.current !== null) clearTimeout(dragToastTimerRef.current);
      if (shakeTimerRef.current !== null) clearTimeout(shakeTimerRef.current);
    };
  }, []);

  function handleDragStart(e: React.DragEvent, source: DragSource) {
    // No global block on drag — even if a rename or create is mid-submit on
    // a different row, the two ops are independent (different endpoints,
    // different rows) and both end with their own `loadAll()`. The "can't
    // drag a row that's currently rendered as the rename input" guard lives
    // on the row itself via `draggable={!isRenaming}`.
    setDrag(source);
    e.dataTransfer.effectAllowed = "move";
    // Firefox refuses to start a drag without `setData`. The payload itself
    // is unused — we route the actual move through React state — but the
    // call is required for the drag to fire at all.
    try {
      const label =
        source.kind === "note" ? `note:${source.nodeId}` : `folder:${source.folderId}`;
      e.dataTransfer.setData("text/plain", label);
    } catch {
      // ignore — Safari occasionally throws on `setData` in non-trusted contexts
    }
  }

  function handleDragEnd() {
    clearDragState();
  }

  /**
   * Update the highlighted drop target on hover. Idempotent — only flips
   * state when the target identity actually changes, so we don't re-render
   * on every dragover frame.
   */
  function setDropHighlight(next: DropTarget | null) {
    setDropTarget((prev) => {
      if (prev === next) return prev;
      if (prev !== null && next !== null && prev.kind === next.kind) {
        if (prev.kind === "folder" && next.kind === "folder") {
          if (prev.folderId === next.folderId) return prev;
        } else if (prev.kind === "root" && next.kind === "root") {
          return prev;
        }
      }
      return next;
    });
  }

  /**
   * Compute the move from the current `drag` source onto the given target.
   * Performs client-side cycle prevention for folder→folder; surfaces server
   * errors via the toast/shake. On success refetches locally so the tree
   * reflects the new shape immediately.
   */
  async function commitDrop(target: DropTarget) {
    if (drag === null) return;
    const targetFolderId = target.kind === "folder" ? target.folderId : null;

    // No-op short-circuits — same parent for either kind. Dropping a row on
    // its own current container shouldn't round-trip. Also: a folder dropped
    // onto itself is the trivially-rejectable cycle case and gets the shake.
    if (drag.kind === "folder" && target.kind === "folder") {
      if (drag.folderId === target.folderId) {
        triggerShake(target.folderId);
        showDragToast("can't drop a folder onto itself");
        clearDragState();
        return;
      }
      if (descendantsOfDrag.has(target.folderId)) {
        triggerShake(target.folderId);
        showDragToast("can't drop a folder into one of its own descendants");
        clearDragState();
        return;
      }
      if (drag.currentParentId === target.folderId) {
        clearDragState();
        return;
      }
    }
    if (drag.kind === "folder" && target.kind === "root") {
      if (drag.currentParentId === null) {
        clearDragState();
        return;
      }
    }
    if (drag.kind === "note" && target.kind === "folder") {
      if (drag.currentFolderId === target.folderId) {
        clearDragState();
        return;
      }
    }
    if (drag.kind === "note" && target.kind === "root") {
      if (drag.currentFolderId === null) {
        clearDragState();
        return;
      }
    }

    // Pre-clear the highlight so the row doesn't keep its drop-target ring
    // while the API call is in flight. We hold onto `drag` only until the
    // API resolves so handleDragEnd's clear is idempotent.
    setDropTarget(null);
    try {
      if (drag.kind === "note") {
        await api.moveNote(drag.nodeId, targetFolderId);
      } else {
        await api.patchFolder(drag.folderId, { parentId: targetFolderId });
      }
      await loadAll();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // The server's cycle/UNIQUE messages are descriptive enough to surface
      // verbatim. We trim the leading "400 Bad Request — " noise.
      const cleaned = msg.replace(/^\d{3}\s[^—]+—\s*/, "");
      showDragToast(cleaned || "move failed");
      // Shake the target folder so the source of the rejection is obvious.
      if (target.kind === "folder") triggerShake(target.folderId);
    } finally {
      clearDragState();
    }
  }

  // ─── Inline-edit lifecycle ────────────────────────────────────────────

  function startEdit(next: EditState) {
    if (editSubmitting) return;
    setEditError(null);
    setEdit(next);
    // If we're creating inside a folder, make sure that folder is expanded
    // so the new row is visible.
    if (
      (next.kind === "create-folder" || next.kind === "create-note") &&
      next.parentId !== null
    ) {
      setExpanded((prev) => {
        if (prev.has(next.parentId as number)) return prev;
        const out = new Set(prev);
        out.add(next.parentId as number);
        return out;
      });
    }
  }

  function cancelEdit() {
    setEdit(null);
    setEditError(null);
  }

  async function commitEdit() {
    if (edit === null || editSubmitting) return;
    const trimmed = edit.draft.trim();

    // Empty / placeholder commit → cancel without API call. Matches the
    // existing flat-list behaviour from m6p2 (blur on an unchanged
    // `untitled` placeholder shouldn't spawn an `untitled` node).
    if (!trimmed || trimmed === UNTITLED_PLACEHOLDER) {
      cancelEdit();
      return;
    }

    // Rename no-op → just close, no PATCH.
    if (edit.kind === "rename-folder") {
      const current = folders?.find((f) => f.id === edit.folderId);
      if (current && current.name === trimmed) {
        cancelEdit();
        return;
      }
    }
    if (edit.kind === "rename-note") {
      const current = notes?.find((n) => n.nodeId === edit.nodeId);
      if (current && current.name === trimmed) {
        cancelEdit();
        return;
      }
    }

    setEditSubmitting(true);
    setEditError(null);
    try {
      switch (edit.kind) {
        case "create-folder": {
          await api.createFolder({ name: trimmed, parentId: edit.parentId });
          setEdit(null);
          await loadAll();
          break;
        }
        case "create-note": {
          const res = await api.createNote({
            name: trimmed,
            folderId: edit.parentId,
          });
          setEdit(null);
          // Same downstream as the header `+`-button flow: parent bumps
          // refreshKey + flips into split-edit. We refetch locally too so
          // the new row shows immediately rather than waiting on the
          // refreshKey round-trip from the parent (which it does fire,
          // but ordering between the two listeners is racy).
          await loadAll();
          onCreateNote(res.nodeId, res.name);
          break;
        }
        case "rename-folder": {
          await api.patchFolder(edit.folderId, { name: trimmed });
          setEdit(null);
          await loadAll();
          break;
        }
        case "rename-note": {
          await api.renameNote(edit.nodeId, trimmed);
          setEdit(null);
          onNoteRenamed(edit.nodeId, trimmed);
          await loadAll();
          break;
        }
      }
    } catch (err) {
      // 409 unique-constraint failures land here. Surface verbatim so the
      // user sees "name already taken" or whatever the server returned.
      setEditError(err instanceof Error ? err.message : String(err));
    } finally {
      setEditSubmitting(false);
    }
  }

  // ─── Right-click menu actions ─────────────────────────────────────────

  function onContextMenu(e: React.MouseEvent, target: MenuTarget) {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, target });
  }

  function closeMenu() {
    setMenu(null);
  }

  function handleMenuAction(action: string) {
    if (menu === null) return;
    const target = menu.target;
    closeMenu();

    if (target.kind === "folder") {
      const f = target.folder;
      if (action === "add-subfolder") {
        startEdit({ kind: "create-folder", parentId: f.id, draft: UNTITLED_PLACEHOLDER });
      } else if (action === "add-note") {
        startEdit({ kind: "create-note", parentId: f.id, draft: UNTITLED_PLACEHOLDER });
      } else if (action === "rename") {
        startEdit({ kind: "rename-folder", folderId: f.id, draft: f.name });
      } else if (action === "delete") {
        void deleteFolderFlow(f);
      }
    } else if (target.kind === "note") {
      const n = target.note;
      if (action === "rename") {
        startEdit({ kind: "rename-note", nodeId: n.nodeId, draft: n.name });
      } else if (action === "delete") {
        void deleteNoteFlow(n);
      }
    } else {
      if (action === "add-folder") {
        startEdit({ kind: "create-folder", parentId: null, draft: UNTITLED_PLACEHOLDER });
      } else if (action === "add-note") {
        startEdit({ kind: "create-note", parentId: null, draft: UNTITLED_PLACEHOLDER });
      }
    }
  }

  async function deleteNoteFlow(note: KgNoteListEntry) {
    // Match the existing `forget`-style posture: no confirmation, the
    // delete is one click on the menu away. The user's selectedNote may
    // be this note — parent clears it via onNoteDeleted.
    try {
      await api.deleteNote(note.nodeId);
      onNoteDeleted(note.nodeId);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function deleteFolderFlow(folder: NoteFolder) {
    if (!folders || !notes) return;
    const counts = countDescendants(folder, folders, notes);
    if (counts.noteCount === 0 && counts.subfolderCount === 0) {
      // Empty folder — just delete (default `unfile` mode is a no-op when
      // there's nothing to unfile; the folder row goes away).
      try {
        await api.deleteFolder(folder.id, "unfile");
        await loadAll();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
      return;
    }
    setDeletePrompt({
      folder,
      noteCount: counts.noteCount,
      subfolderCount: counts.subfolderCount,
    });
  }

  async function performFolderDelete(mode: "unfile" | "cascade") {
    if (deletePrompt === null) return;
    const folder = deletePrompt.folder;
    setDeletePrompt(null);
    try {
      const result = await api.deleteFolder(folder.id, mode);
      // In cascade mode, every contained note's underlying node was just
      // deleted server-side. If `selectedNote` was one of them, clear it.
      // We don't have a per-note id list back from the server — just hand
      // the parent the easy case (was the active note inside this tree?)
      // by checking before we refetch. The user's selectedNoteId is held
      // by the parent; we approximate "selected note got nuked" by asking
      // whether the active note was inside this folder's subtree.
      if (mode === "cascade" && notes && selectedNoteId !== null) {
        const subfolderIds = new Set<number>();
        function walk(parentId: number) {
          if (!folders) return;
          for (const f of folders) {
            if (f.parentId === parentId) {
              subfolderIds.add(f.id);
              walk(f.id);
            }
          }
        }
        walk(folder.id);
        const wasInSubtree = notes.some(
          (n) =>
            n.nodeId === selectedNoteId &&
            (n.folderId === folder.id ||
              (n.folderId !== null && subfolderIds.has(n.folderId))),
        );
        if (wasInSubtree) onNoteDeleted(selectedNoteId);
      }
      void result; // counts are surfaced indirectly through the refetch
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  // ─── Header `+` (matches m6p2 — adds a root-level note) ───────────────

  function handleHeaderPlus() {
    startEdit({ kind: "create-note", parentId: null, draft: UNTITLED_PLACEHOLDER });
  }

  // ─── Tree rendering ───────────────────────────────────────────────────

  const empty =
    tree !== null &&
    tree.rootFolders.length === 0 &&
    tree.rootNotes.length === 0 &&
    edit === null;

  return (
    <aside className="relative hidden lg:flex w-64 shrink-0 flex-col border-r border-zinc-900/80 bg-zinc-950 animate-fade-in">
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-900/80 px-4 py-2.5">
        <FileText className="h-3.5 w-3.5 text-zinc-500" />
        <span className="text-[11px] uppercase tracking-wider text-zinc-500">notes</span>
        <button
          type="button"
          onClick={handleHeaderPlus}
          aria-label="new note"
          title="New note"
          disabled={editSubmitting || edit !== null}
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

      <div
        className="flex-1 overflow-y-auto px-2 py-2"
        // Right-click on empty space in the scroll area opens the
        // empty-context menu (Add folder / Add note at root). Sub-rows
        // stop propagation so their own onContextMenu wins.
        onContextMenu={(e) => onContextMenu(e, { kind: "empty" })}
        // The scroll container itself acts as a root-zone drop target so
        // dragging onto the empty space below the tree un-files the row.
        // Folder/note rows below stop propagation on their own dragover so
        // their target wins. We only flip the highlight to "root" when no
        // child row claimed the event.
        onDragOver={(e) => {
          if (drag === null) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setDropHighlight({ kind: "root" });
        }}
        onDragLeave={(e) => {
          if (drag === null) return;
          // Only clear when leaving the container itself, not on bubble-up
          // from a child row crossing its own boundary.
          if (e.currentTarget === e.target) {
            setDropHighlight(null);
          }
        }}
        onDrop={(e) => {
          if (drag === null) return;
          e.preventDefault();
          void commitDrop({ kind: "root" });
        }}
      >
        {/* Sticky-top "Unfiled" drop zone — only visible while a drag is in
            flight, so it doesn't take up sidebar real estate at rest. */}
        {drag !== null && (
          <div
            className={`mb-1 flex items-center gap-2 rounded-md border border-dashed px-2 py-1.5 text-[11px] uppercase tracking-wider transition ${
              dropTarget?.kind === "root"
                ? "border-zinc-600 bg-zinc-800 text-zinc-200"
                : "border-zinc-800 bg-zinc-950 text-zinc-500"
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = "move";
              setDropHighlight({ kind: "root" });
            }}
            onDragLeave={(e) => {
              if (e.currentTarget === e.target) setDropHighlight(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void commitDrop({ kind: "root" });
            }}
            aria-label="drop here to un-file"
          >
            <FolderOpen className="h-3 w-3 opacity-70" />
            <span>unfiled (root)</span>
          </div>
        )}

        {editError && (
          <p className="mb-2 px-2 text-xs text-red-400">action failed: {editError}</p>
        )}

        {error ? (
          <p className="px-2 text-xs text-red-400">{error}</p>
        ) : tree === null ? (
          <p className="px-2 text-xs text-zinc-600">loading…</p>
        ) : empty ? (
          <p className="px-2 text-xs text-zinc-600">
            no notes yet — click the <span className="text-zinc-300">+</span> to create
            one.
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {tree.rootFolders.map((tf) => (
              <FolderRow
                key={`f-${tf.folder.id}`}
                tf={tf}
                depth={0}
                expanded={expanded}
                toggleExpanded={toggleExpanded}
                edit={edit}
                editSubmitting={editSubmitting}
                inputRef={inputRef}
                onEditChange={(v) =>
                  setEdit((prev) => (prev ? { ...prev, draft: v } : prev))
                }
                onEditCommit={commitEdit}
                onEditCancel={cancelEdit}
                onContextMenu={onContextMenu}
                selectedNoteId={selectedNoteId}
                onSelectNote={onSelectNote}
                drag={drag}
                dropTarget={dropTarget}
                shakeFolderId={shakeFolderId}
                descendantsOfDrag={descendantsOfDrag}
                onDragStartRow={handleDragStart}
                onDragEndRow={handleDragEnd}
                onDropOnFolder={(folderId) =>
                  void commitDrop({ kind: "folder", folderId })
                }
                onDropOntoNotesParent={(folderId) =>
                  void commitDrop(
                    folderId === null ? { kind: "root" } : { kind: "folder", folderId },
                  )
                }
                setDropHighlight={setDropHighlight}
              />
            ))}

            {/* Root-level inline create row (folder or note at parent=null) */}
            {edit !== null &&
              (edit.kind === "create-folder" || edit.kind === "create-note") &&
              edit.parentId === null && (
                <li>
                  <InlineEditRow
                    icon={edit.kind === "create-folder" ? "folder" : "note"}
                    depth={0}
                    value={edit.draft}
                    inputRef={inputRef}
                    submitting={editSubmitting}
                    onChange={(v) =>
                      setEdit((prev) => (prev ? { ...prev, draft: v } : prev))
                    }
                    onCommit={commitEdit}
                    onCancel={cancelEdit}
                    ariaLabel={
                      edit.kind === "create-folder" ? "new folder name" : "new note name"
                    }
                  />
                </li>
              )}

            {tree.rootNotes.map((n) => {
              const isRenaming = edit?.kind === "rename-note" && edit.nodeId === n.nodeId;
              return (
                <NoteRow
                  key={`n-${n.nodeId}`}
                  note={n}
                  depth={0}
                  active={n.nodeId === selectedNoteId}
                  isRenaming={isRenaming}
                  edit={isRenaming ? edit : null}
                  inputRef={isRenaming ? inputRef : null}
                  editSubmitting={editSubmitting}
                  onEditChange={(v) =>
                    setEdit((prev) => (prev ? { ...prev, draft: v } : prev))
                  }
                  onEditCommit={commitEdit}
                  onEditCancel={cancelEdit}
                  onSelectNote={onSelectNote}
                  onContextMenu={onContextMenu}
                  drag={drag}
                  onDragStartRow={handleDragStart}
                  onDragEndRow={handleDragEnd}
                  descendantsOfDrag={descendantsOfDrag}
                  setDropHighlight={setDropHighlight}
                  onDropOntoNotesParent={(folderId) =>
                    void commitDrop(
                      folderId === null ? { kind: "root" } : { kind: "folder", folderId },
                    )
                  }
                />
              );
            })}
          </ul>
        )}
      </div>

      {/* Toast: brief inline rejection message. Bottom-anchored so it doesn't
          shove the tree around. Only visible while there's a message. */}
      {dragToast !== null && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none absolute bottom-3 left-3 right-3 z-30 rounded-md border border-zinc-800 bg-zinc-900/95 px-3 py-2 text-xs text-zinc-200 shadow-lg animate-fade-in"
        >
          {dragToast}
        </div>
      )}

      {menu !== null && (
        <ContextMenu menu={menu} onAction={handleMenuAction} onDismiss={closeMenu} />
      )}

      {deletePrompt !== null && (
        <DeleteFolderPrompt
          state={deletePrompt}
          onMoveToUnfiled={() => void performFolderDelete("unfile")}
          onCascade={() => void performFolderDelete("cascade")}
          onCancel={() => setDeletePrompt(null)}
        />
      )}
    </aside>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────

interface FolderRowProps {
  tf: TreeFolder;
  depth: number;
  expanded: Set<number>;
  toggleExpanded: (id: number) => void;
  edit: EditState | null;
  editSubmitting: boolean;
  inputRef: React.RefObject<HTMLInputElement>;
  onEditChange: (v: string) => void;
  onEditCommit: () => void;
  onEditCancel: () => void;
  onContextMenu: (e: React.MouseEvent, target: MenuTarget) => void;
  selectedNoteId: string | null;
  onSelectNote: (nodeId: string, name: string) => void;
  /** Currently-dragged source — passed down so rows can render the dimmed
   *  state and skip drop handling on themselves. */
  drag: DragSource | null;
  /** Currently highlighted drop target — used to render the ring. */
  dropTarget: DropTarget | null;
  /** Folder id that should play the rejection shake on this render. */
  shakeFolderId: number | null;
  /** Set of folder ids that are descendants of the currently-dragged folder.
   *  Used to suppress the drop highlight on invalid (cycle-creating) targets. */
  descendantsOfDrag: Set<number>;
  onDragStartRow: (e: React.DragEvent, source: DragSource) => void;
  onDragEndRow: () => void;
  /** Called when the user drops onto this folder's header row. */
  onDropOnFolder: (folderId: number) => void;
  /** Pass-through for `NoteRow`'s drop-onto-parent delegate (a hover over a
   *  note row counts as a hover over its parent folder, which can be the
   *  root if the note is unfiled). */
  onDropOntoNotesParent: (folderId: number | null) => void;
  setDropHighlight: (next: DropTarget | null) => void;
}

/**
 * Recursive folder + contents renderer. We render in this order so the
 * tree shape mirrors VSCode's explorer:
 *
 * 1. The folder header (chevron + folder icon + name).
 * 2. Inline-create row, if the user is currently creating a child of
 *    this folder (and we're expanded).
 * 3. Subfolders.
 * 4. Notes inside this folder.
 */
function FolderRow({
  tf,
  depth,
  expanded,
  toggleExpanded,
  edit,
  editSubmitting,
  inputRef,
  onEditChange,
  onEditCommit,
  onEditCancel,
  onContextMenu,
  selectedNoteId,
  onSelectNote,
  drag,
  dropTarget,
  shakeFolderId,
  descendantsOfDrag,
  onDragStartRow,
  onDragEndRow,
  onDropOnFolder,
  onDropOntoNotesParent,
  setDropHighlight,
}: FolderRowProps) {
  const isRenaming = edit?.kind === "rename-folder" && edit.folderId === tf.folder.id;
  const isOpen = expanded.has(tf.folder.id);
  const padLeft = 8 + depth * 12;

  // Drag-derived UI state for *this* folder row.
  const isBeingDragged = drag?.kind === "folder" && drag.folderId === tf.folder.id;
  const isDropHover =
    dropTarget?.kind === "folder" && dropTarget.folderId === tf.folder.id;
  const isShaking = shakeFolderId === tf.folder.id;
  // True when this row is a descendant of the dragged folder — dropping the
  // dragged folder here would create a cycle, so we suppress the drop.
  const isDescendantOfDrag = descendantsOfDrag.has(tf.folder.id);

  return (
    <li>
      {isRenaming && edit ? (
        <InlineEditRow
          icon="folder"
          depth={depth}
          value={edit.draft}
          inputRef={inputRef}
          submitting={editSubmitting}
          onChange={onEditChange}
          onCommit={onEditCommit}
          onCancel={onEditCancel}
          ariaLabel="folder name"
        />
      ) : (
        <button
          type="button"
          onClick={() => toggleExpanded(tf.folder.id)}
          onContextMenu={(e) => onContextMenu(e, { kind: "folder", folder: tf.folder })}
          // The folder header is both a draggable row (for re-nesting) and
          // a drop target (for receiving dropped notes/folders). When the
          // row is currently rendered as the rename input, the InlineEditRow
          // branch above takes over — so this branch is only ever reached
          // when the row is *not* in rename mode.
          draggable={true}
          onDragStart={(e) => {
            // Stop the click from also triggering toggle-expanded — drag
            // takes priority. The browser's native drag start already
            // suppresses the click, but stopPropagation prevents an
            // upstream `dragstart` from re-firing.
            e.stopPropagation();
            onDragStartRow(e, {
              kind: "folder",
              folderId: tf.folder.id,
              currentParentId: tf.folder.parentId,
            });
          }}
          onDragEnd={onDragEndRow}
          onDragOver={(e) => {
            if (drag === null) return;
            // Suppress dragover (no preventDefault → no drop allowed, no
            // highlight) for invalid targets so the cursor shows the
            // no-drop icon and the row doesn't pretend to be a target:
            //   - dragging this same folder onto itself
            //   - dragging a folder onto one of its descendants
            // Server still rejects either case if a custom drop slipped
            // through (defense in depth via `commitDrop`'s pre-flight),
            // but the visual stays honest.
            if (drag.kind === "folder") {
              if (drag.folderId === tf.folder.id) return;
              if (isDescendantOfDrag) return;
            }
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = "move";
            setDropHighlight({ kind: "folder", folderId: tf.folder.id });
          }}
          // No onDragLeave handler — the next dragover (sibling row, or the
          // scroll container) sets its own highlight, and dragend clears
          // everything. Letting dragleave fire would cause flicker when the
          // cursor crosses into a child element of this same row.
          onDrop={(e) => {
            if (drag === null) return;
            e.preventDefault();
            e.stopPropagation();
            onDropOnFolder(tf.folder.id);
          }}
          className={`flex w-full items-center gap-1 rounded-md py-1.5 pr-2 text-left text-sm text-zinc-300 transition hover:bg-zinc-900/60 hover:text-zinc-100 ${
            isBeingDragged ? "opacity-50" : ""
          } ${
            isDropHover ? "bg-zinc-800 ring-1 ring-zinc-600" : ""
          } ${isShaking ? "animate-shake" : ""}`}
          style={{ paddingLeft: padLeft }}
        >
          {isOpen ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-zinc-500" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-zinc-500" />
          )}
          {isOpen ? (
            <FolderOpen className="h-3.5 w-3.5 shrink-0 opacity-70" />
          ) : (
            <Folder className="h-3.5 w-3.5 shrink-0 opacity-70" />
          )}
          <span className="flex-1 truncate">{tf.folder.name}</span>
        </button>
      )}

      {isOpen && (
        <ul className="flex flex-col gap-0.5">
          {edit !== null &&
            (edit.kind === "create-folder" || edit.kind === "create-note") &&
            edit.parentId === tf.folder.id && (
              <li>
                <InlineEditRow
                  icon={edit.kind === "create-folder" ? "folder" : "note"}
                  depth={depth + 1}
                  value={edit.draft}
                  inputRef={inputRef}
                  submitting={editSubmitting}
                  onChange={onEditChange}
                  onCommit={onEditCommit}
                  onCancel={onEditCancel}
                  ariaLabel={
                    edit.kind === "create-folder" ? "new folder name" : "new note name"
                  }
                />
              </li>
            )}

          {tf.subfolders.map((sf) => (
            <FolderRow
              key={`f-${sf.folder.id}`}
              tf={sf}
              depth={depth + 1}
              expanded={expanded}
              toggleExpanded={toggleExpanded}
              edit={edit}
              editSubmitting={editSubmitting}
              inputRef={inputRef}
              onEditChange={onEditChange}
              onEditCommit={onEditCommit}
              onEditCancel={onEditCancel}
              onContextMenu={onContextMenu}
              selectedNoteId={selectedNoteId}
              onSelectNote={onSelectNote}
              drag={drag}
              dropTarget={dropTarget}
              shakeFolderId={shakeFolderId}
              descendantsOfDrag={descendantsOfDrag}
              onDragStartRow={onDragStartRow}
              onDragEndRow={onDragEndRow}
              onDropOnFolder={onDropOnFolder}
              onDropOntoNotesParent={onDropOntoNotesParent}
              setDropHighlight={setDropHighlight}
            />
          ))}

          {tf.notes.map((n) => {
            const isNoteRenaming =
              edit?.kind === "rename-note" && edit.nodeId === n.nodeId;
            return (
              <NoteRow
                key={`n-${n.nodeId}`}
                note={n}
                depth={depth + 1}
                active={n.nodeId === selectedNoteId}
                isRenaming={isNoteRenaming}
                edit={isNoteRenaming ? edit : null}
                inputRef={isNoteRenaming ? inputRef : null}
                editSubmitting={editSubmitting}
                onEditChange={onEditChange}
                onEditCommit={onEditCommit}
                onEditCancel={onEditCancel}
                onSelectNote={onSelectNote}
                onContextMenu={onContextMenu}
                drag={drag}
                onDragStartRow={onDragStartRow}
                onDragEndRow={onDragEndRow}
                descendantsOfDrag={descendantsOfDrag}
                setDropHighlight={setDropHighlight}
                onDropOntoNotesParent={onDropOntoNotesParent}
              />
            );
          })}
        </ul>
      )}
    </li>
  );
}

interface NoteRowProps {
  note: KgNoteListEntry;
  depth: number;
  active: boolean;
  isRenaming: boolean;
  edit: EditState | null;
  inputRef: React.RefObject<HTMLInputElement> | null;
  editSubmitting: boolean;
  onEditChange: (v: string) => void;
  onEditCommit: () => void;
  onEditCancel: () => void;
  onSelectNote: (nodeId: string, name: string) => void;
  onContextMenu: (e: React.MouseEvent, target: MenuTarget) => void;
  /** Active drag source — used to dim the row when this note is being dragged. */
  drag: DragSource | null;
  onDragStartRow: (e: React.DragEvent, source: DragSource) => void;
  onDragEndRow: () => void;
  /** Set of folder ids that are descendants of the currently-dragged folder.
   *  Note rows in a descendant folder shouldn't claim a hover highlight on
   *  behalf of a cycle-creating parent. */
  descendantsOfDrag: Set<number>;
  setDropHighlight: (next: DropTarget | null) => void;
  /** Drop into a specific folder (or root, when `folderId === null`). */
  onDropOntoNotesParent: (folderId: number | null) => void;
}

function NoteRow({
  note,
  depth,
  active,
  isRenaming,
  edit,
  inputRef,
  editSubmitting,
  onEditChange,
  onEditCommit,
  onEditCancel,
  onSelectNote,
  onContextMenu,
  drag,
  onDragStartRow,
  onDragEndRow,
  descendantsOfDrag,
  setDropHighlight,
  onDropOntoNotesParent,
}: NoteRowProps) {
  if (isRenaming && edit && inputRef) {
    return (
      <li>
        <InlineEditRow
          icon="note"
          depth={depth}
          value={edit.draft}
          inputRef={inputRef}
          submitting={editSubmitting}
          onChange={onEditChange}
          onCommit={onEditCommit}
          onCancel={onEditCancel}
          ariaLabel="note name"
        />
      </li>
    );
  }
  const padLeft = 8 + depth * 12;
  const isBeingDragged = drag?.kind === "note" && drag.nodeId === note.nodeId;
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelectNote(note.nodeId, note.name)}
        onContextMenu={(e) => onContextMenu(e, { kind: "note", note })}
        // Note rows are draggable but not first-class drop targets — folders
        // receive the drop. We do, however, delegate hover to the note's
        // *parent* folder (matching VSCode's explorer): hovering a note
        // inside FolderA highlights FolderA so the drop visually lands "in
        // here". The rename branch above already swaps this out for an
        // InlineEditRow, so reaching this code path means the row isn't
        // being renamed.
        draggable={true}
        onDragStart={(e) => {
          e.stopPropagation();
          onDragStartRow(e, {
            kind: "note",
            nodeId: note.nodeId,
            currentFolderId: note.folderId,
          });
        }}
        onDragEnd={onDragEndRow}
        onDragOver={(e) => {
          if (drag === null) return;
          // If the dragged folder *is* this note's parent or one of its
          // descendants (impossible since notes only live in one folder, but
          // defensive), suppress so the drop falls back to root.
          if (drag.kind === "folder" && note.folderId !== null) {
            if (drag.folderId === note.folderId) return;
            if (descendantsOfDrag.has(note.folderId)) return;
          }
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "move";
          setDropHighlight(
            note.folderId === null
              ? { kind: "root" }
              : { kind: "folder", folderId: note.folderId },
          );
        }}
        onDrop={(e) => {
          if (drag === null) return;
          e.preventDefault();
          e.stopPropagation();
          onDropOntoNotesParent(note.folderId);
        }}
        className={`flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left text-sm transition ${
          active
            ? "bg-zinc-900 text-zinc-100"
            : "text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-200"
        } ${isBeingDragged ? "opacity-50" : ""}`}
        style={{ paddingLeft: padLeft }}
      >
        <FileText className="h-3.5 w-3.5 shrink-0 opacity-60" />
        <span className="flex-1 truncate">{note.name}</span>
        <span className="shrink-0 text-[10px] text-zinc-600">{note.type}</span>
      </button>
    </li>
  );
}

interface InlineEditRowProps {
  icon: "folder" | "note";
  depth: number;
  value: string;
  inputRef: React.RefObject<HTMLInputElement>;
  submitting: boolean;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  ariaLabel: string;
}

/**
 * The inline edit textbox row. Used for both create and rename flows; the
 * difference between them lives in the parent commit handler. Enter
 * commits, Esc cancels, blur commits (matches VSCode's explorer).
 *
 * Implementation note: cancel-on-Esc fires before blur lands (we set the
 * draft to null synchronously inside the keydown handler, and the blur
 * branch reads the latest `edit` via a closure). To prevent a double-fire
 * where Esc cancels and then blur tries to commit again, the parent's
 * commitEdit treats a null edit slot as a no-op.
 */
function InlineEditRow({
  icon,
  depth,
  value,
  inputRef,
  submitting,
  onChange,
  onCommit,
  onCancel,
  ariaLabel,
}: InlineEditRowProps) {
  const padLeft = 8 + depth * 12;
  // Escape sets a flag so the blur that follows skips its commit branch.
  const cancelledRef = useRef(false);
  return (
    <div
      className="mb-0.5 flex w-full items-center gap-2 rounded-md bg-zinc-900 py-1.5 pr-2"
      style={{ paddingLeft: padLeft }}
    >
      {icon === "folder" ? (
        <Folder className="h-3.5 w-3.5 shrink-0 opacity-70" />
      ) : (
        <FileText className="h-3.5 w-3.5 shrink-0 opacity-60" />
      )}
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          if (cancelledRef.current) {
            cancelledRef.current = false;
            return;
          }
          onCommit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onCommit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancelledRef.current = true;
            onCancel();
          }
        }}
        disabled={submitting}
        className="min-w-0 flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none disabled:opacity-60"
        spellCheck={false}
        aria-label={ariaLabel}
      />
    </div>
  );
}

interface ContextMenuProps {
  menu: MenuState;
  onAction: (action: string) => void;
  onDismiss: () => void;
}

/**
 * Custom right-click menu. Positioned at the cursor; clamped to stay inside
 * the viewport. A backdrop captures click-anywhere-to-dismiss without
 * firing other handlers.
 */
function ContextMenu({ menu, onAction, onDismiss }: ContextMenuProps) {
  // Items depend on what was right-clicked.
  let items: { label: string; action: string; danger?: boolean }[];
  if (menu.target.kind === "folder") {
    items = [
      { label: "Add subfolder", action: "add-subfolder" },
      { label: "Add note", action: "add-note" },
      { label: "Rename", action: "rename" },
      { label: "Delete", action: "delete", danger: true },
    ];
  } else if (menu.target.kind === "note") {
    items = [
      { label: "Rename", action: "rename" },
      { label: "Delete", action: "delete", danger: true },
    ];
  } else {
    items = [
      { label: "Add folder", action: "add-folder" },
      { label: "Add note", action: "add-note" },
    ];
  }

  // Clamp position so the menu doesn't overflow off the right/bottom edge.
  // Width/height are estimates good enough for a 2–4 item menu.
  const ESTIMATED_WIDTH = 180;
  const ESTIMATED_HEIGHT = items.length * 32 + 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const x = Math.min(menu.x, Math.max(0, vw - ESTIMATED_WIDTH - 4));
  const y = Math.min(menu.y, Math.max(0, vh - ESTIMATED_HEIGHT - 4));

  return (
    <>
      {/* Backdrop — full-screen invisible click-trap */}
      <div
        className="fixed inset-0 z-50"
        onClick={onDismiss}
        onContextMenu={(e) => {
          // Right-click on the backdrop should also dismiss without
          // popping the browser's native menu.
          e.preventDefault();
          onDismiss();
        }}
      />
      <div
        role="menu"
        aria-label="context menu"
        className="fixed z-50 min-w-[160px] overflow-hidden rounded-md border border-zinc-800 bg-zinc-950 py-1 text-sm shadow-2xl animate-fade-in"
        style={{ left: x, top: y }}
      >
        {items.map((item) => (
          <button
            key={item.action}
            type="button"
            role="menuitem"
            onClick={() => onAction(item.action)}
            className={`block w-full px-3 py-1.5 text-left transition ${
              item.danger
                ? "text-red-400 hover:bg-red-500/10 hover:text-red-300"
                : "text-zinc-200 hover:bg-zinc-900 hover:text-zinc-50"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
    </>
  );
}

interface DeleteFolderPromptProps {
  state: DeletePromptState;
  onMoveToUnfiled: () => void;
  onCascade: () => void;
  onCancel: () => void;
}

/**
 * Modal shown when the user deletes a non-empty folder. Three actions:
 *
 * - **Move to Unfiled** (default focus) — drops the folder + descendant
 *   folders, but contained notes stay alive at the unfiled root.
 * - **Delete folder + contents** — cascade; the underlying nodes for
 *   every contained note are deleted too.
 * - **Cancel** — close without doing anything.
 */
function DeleteFolderPrompt({
  state,
  onMoveToUnfiled,
  onCascade,
  onCancel,
}: DeleteFolderPromptProps) {
  const moveBtnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    moveBtnRef.current?.focus();
  }, []);

  const { folder, noteCount, subfolderCount } = state;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-label="confirm folder delete"
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      <div className="mx-4 w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl">
        <div className="border-b border-zinc-900 px-5 py-3">
          <h2 className="text-sm font-medium text-zinc-100">Delete folder</h2>
        </div>
        <div className="px-5 py-4 text-sm text-zinc-300">
          Delete folder <span className="font-mono text-zinc-100">{folder.name}</span>? It
          contains {noteCount} {noteCount === 1 ? "note" : "notes"} and {subfolderCount}{" "}
          {subfolderCount === 1 ? "subfolder" : "subfolders"}.
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-zinc-900 px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-300 transition hover:border-zinc-700 hover:bg-zinc-900"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onCascade}
            className="rounded-md border border-red-900/60 bg-red-950/40 px-3 py-1.5 text-xs text-red-300 transition hover:border-red-800 hover:bg-red-950/60"
          >
            Delete folder + contents
          </button>
          <button
            ref={moveBtnRef}
            type="button"
            onClick={onMoveToUnfiled}
            className="rounded-md border border-zinc-700 bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-900 transition hover:bg-white"
          >
            Move to Unfiled
          </button>
        </div>
      </div>
    </div>
  );
}
