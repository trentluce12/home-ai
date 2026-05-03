# Folder CRUD UI — right-click menu + inline rename + delete prompt

**Why:** Without a UI for the folder operations, the schema and endpoints from `m6p3-folder-schema` are unreachable to users.
**What:** NotesSidebar gains a right-click context menu (custom, not the browser's). Menu options are context-sensitive:
- Right-click on a folder row: `Add subfolder`, `Add note`, `Rename`, `Delete`.
- Right-click on a note row: `Rename`, `Delete`.
- Right-click on empty space (below all rows): `Add folder`, `Add note` (both create at root / unfiled).

`Add subfolder` / `Add folder` / `Add note` reuse the inline-edit-with-`untitled`-placeholder UX from `m6p2-note-creation-flow` — a new row appears at the appropriate place in the tree with a focused textbox; Enter commits, Esc cancels. `Rename` swaps the row text for an editable textbox pre-filled with the current name; Enter commits via PATCH, Esc cancels. `Delete` on a note: hits DELETE on the existing note endpoint (no prompt — the note is one user action away from being un-deletable, but that's the same posture as the current per-node delete; matches `forget` behavior). `Delete` on a folder: if the folder has any notes or subfolders, prompt: "Delete folder `<name>`? It contains N notes and M subfolders. [Move to Unfiled] [Delete folder + contents] [Cancel]". Default focus is `Move to Unfiled`. If folder is empty, no prompt — just deletes. Tree re-renders after each op via SWR-style refetch (the sidebar already polls or refreshes on demand from `m6p2`). Click-outside on an inline-edit row commits (Enter-equivalent) — matches VSCode's behavior.
**Files:** `web/src/components/NotesSidebar.tsx`, `web/src/lib/api.ts`
**Estimate:** medium-large — context menu component + inline-edit reuse + delete-prompt modal
**Dependencies:** m6p3-folder-schema
**Smoke steps:**
1. `npm run dev`, log in, open Notes view. Right-click a folder → 4-option menu appears.
2. `Add subfolder` → inline `untitled` placeholder under the folder, focused; type "Pets", Enter → folder created, tree re-renders.
3. `Add note` on the new folder → inline `untitled` row inside Pets, focused; type "Snickers vet records", Enter → note created in Pets.
4. Right-click the new note → 2-option menu (Rename / Delete). `Rename` → row becomes editable with current name pre-filled; type new name, Enter → PATCH fires, name updates.
5. Right-click empty space below the tree → 2-option menu (Add folder / Add note); Add folder → creates at root.
6. Right-click a non-empty folder → `Delete`. Prompt appears with note + subfolder counts; click `Move to Unfiled` → folder deleted, contents moved to root level.
7. Re-create the structure, this time click `Delete folder + contents` → folder + all descendant notes deleted (cascade).
8. Right-click empty folder → `Delete` → no prompt, just deletes immediately.
9. Click outside an inline-edit row → commits (matches VSCode); pressing Esc → cancels and the row reverts.
10. Try `Rename` to a name that collides with a sibling folder → error toast with the unique-constraint message.

---

**Status:** pending
**Started:** —

## Notes
