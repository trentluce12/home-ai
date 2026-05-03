# Notes schema + node-detail editor

**Why:** Foundation for M5. Without the table and a way to write notes, nothing else in the milestone works. Manual authoring first; agent tooling comes in phase 2.
**What:** Add `node_notes(node_id INTEGER PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE, body TEXT NOT NULL, updated_at TEXT NOT NULL)`. Helpers in `kg/db.ts`: `getNote(nodeId)`, `setNote(nodeId, body)` (upsert), `deleteNote(nodeId)`. Endpoints: `GET /api/kg/node/:id/note`, `PUT /api/kg/node/:id/note`, `DELETE /api/kg/node/:id/note`. In the existing graph-modal node detail panel: markdown textarea + preview tab, empty-state hint when no note exists, save-on-blur (or save-button — pick one and document).
**Files:** `server/src/kg/db.ts`, `server/src/index.ts`, `web/src/components/GraphView.tsx` (or wherever the node detail panel lives), `web/src/lib/api.ts`
**Estimate:** medium — schema is small; the editor UX needs care
**Dependencies:** none
**Smoke steps:**
1. `npm run dev`, log in, open the graph modal, click any node — node detail panel opens.
2. Empty-state shows "no notes yet"; click into the editor, type some markdown, save.
3. Reload the page, re-open the same node — note body persists.
4. Run `forget` on the node — note row deletes too (FK cascade); verify with a SQL count or stats refresh.

---

**Status:** pending
**Started:** —

## Notes
