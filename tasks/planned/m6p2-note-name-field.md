# Note name field — decoupled from node name

**Why:** Notes need a human-facing label that can drift independently from the underlying node's name. A note attached to `Person:Alice` might be titled "Alice's birthday list" without renaming Alice. This is the architectural hinge of M6 — without it, the tree is forced to display node names, breaking the "renaming the note doesn't rename the node" contract.
**What:** Add `name TEXT NOT NULL` column to `node_notes`. Migrate existing rows: backfill `name` with the parent node's `name` (one SQL `UPDATE ... FROM nodes` join). `getNote(nodeId)` returns `{nodeId, name, body, updatedAt}`. `setNote(nodeId, body, name?)` upserts both columns; if `name` is omitted on update, leaves the existing value (the editor and propose_note_edit don't pass it). `PUT /api/kg/node/:id/note` body schema gains optional `name`. New `PATCH /api/kg/node/:id/note` (or extend PUT) for rename-only — frontend hits this from the right-click `Rename` action in phase 3. `GET /api/kg/notes` returns each row's `name`. The dashboard's recent-notes widget, the `NotesView` preview header, and the `NotesSidebar` row labels all switch to displaying note `name` (not node name). Existing per-node editor (in `GraphView` detail panel) stays unchanged for the body; if the note row has no name yet (shouldn't happen post-migration, but defensively), default to the node's name. Update the seed: `NOTES` array gains `name` per entry (default to the node's name for the 4 seeded notes — keeps a sensible starting state).
**Files:** `server/src/kg/db.ts`, `server/src/index.ts`, `server/src/seed.ts`, `web/src/components/GraphView.tsx`, `web/src/components/EmptyDashboard.tsx`, `web/src/components/NotesView.tsx`, `web/src/components/NotesSidebar.tsx`, `web/src/lib/api.ts`
**Estimate:** large — schema migration + propagation across multiple UI surfaces
**Dependencies:** m6p2-notes-view-shell
**Smoke steps:**
1. `npm run dev` (re-seeds) → console reports `4 notes`. Notes view secondary sidebar shows note names matching the seeded names (currently same as node names).
2. SQL inspect: `SELECT node_id, name FROM node_notes` → all 4 rows have a `name` populated.
3. In dev, manually update a note's name via SQL: `UPDATE node_notes SET name = 'home-ai readme' WHERE node_id = (SELECT id FROM nodes WHERE name = 'home-ai')`. Refresh dashboard recent-notes panel + NotesSidebar list → both show "home-ai readme" but the graph view detail panel still shows the node's name as "home-ai" (decoupled).
4. Ask the agent in chat: "what do you know about home-ai?" → agent retrieves the home-ai node + note; retrieval context shows the node name as "home-ai" (unchanged); response references the note body correctly.
5. PUT body change via the editor → name is left untouched (only body updates).

---

**Status:** pending
**Started:** —

## Notes
