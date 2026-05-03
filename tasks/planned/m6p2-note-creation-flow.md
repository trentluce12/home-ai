# Note creation flow — VSCode-style inline + Generic type

**Why:** Closes phase 2's ergonomic loop. Today, creating a note requires navigating to a node first; users want to jot a note without that ritual. The Generic type lands so notes-without-classification have a place in the type taxonomy.
**What:** New `POST /api/kg/notes` endpoint: body `{name, type?, body?, folderId?}` (folderId is null for now — folders land phase 3). Creates a node (default type `Generic` if not specified) + a note row in a single transaction. Returns `{nodeId, name, body, updatedAt}`. Embeddings happen in the background — same fire-and-forget posture as `record_user_fact`. NotesSidebar gains a `+` icon in its header (next to a future folder icon — for now, just the note `+`). Click → a new row appears at the top of the flat list with an inline-editable `untitled` placeholder; the textbox is auto-focused. Enter or blur commits the new note (with `body: ""`); Esc cancels. After commit, the new row is selected and the main panel transitions to split-edit mode (editor focused, ready for body input). The `Generic` type doesn't need a schema change — types are free-form strings. Add it to the existing type-color palette in the graph view (`Generic` gets its own zinc-tone color slot so it shows in the graph by default). Filter chips in the graph include `Generic`; toggle works like every other type.
**Files:** `server/src/kg/db.ts`, `server/src/index.ts`, `web/src/components/NotesSidebar.tsx`, `web/src/components/NotesView.tsx`, `web/src/components/GraphView.tsx`, `web/src/lib/api.ts`
**Estimate:** medium — backend is one transactional endpoint; frontend is the inline-edit dance
**Dependencies:** m6p2-notes-view-shell, m6p2-note-name-field
**Smoke steps:**
1. `npm run dev`, log in, click `Notes`. Secondary sidebar header shows `+` icon.
2. Click `+` → new row at top with `untitled` in an editable textbox, focused.
3. Type "Birthday party 2026", press Enter → row commits; main panel switches to split-edit mode for the new note (empty body).
4. Type some markdown into the editor, blur → save-on-blur fires; refresh page → note persists with name + body.
5. Open `Knowledge Graph` → graph view (still modal in this phase) includes a new `Generic`-typed node named "Birthday party 2026", appearing in the graph with the `Generic` color. Filter chip for `Generic` toggles it.
6. Click the new node in the graph → detail panel shows it with type `Generic`, no edges, the note body present.
7. Re-run the create flow but press Esc on the inline name → row disappears; no API call fires; no orphan node.
8. Stress test: hit `+` again, type "x", commit, immediately rename via right-click (phase 3) — wait, rename lands phase 3. For now, just verify the inline-create commit works.

---

**Status:** pending
**Started:** —

## Notes
