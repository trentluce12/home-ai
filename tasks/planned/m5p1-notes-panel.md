# Notes panel in empty-state dashboard

**Why:** Browsing notes by clicking through nodes in the graph modal is tedious. A flat list view makes notes discoverable.
**What:** New "Notes" section in the empty-state dashboard. Backend: `GET /api/kg/notes` returns `[{nodeId, name, type, preview, updatedAt}]` for every node with a non-empty note (preview = first ~200 chars). UI: list rows showing node name + type chip + preview snippet + relative-time stamp; click → opens the graph modal scoped to that node's detail panel. Empty state: "No notes yet — open a node in the graph and add one."
**Files:** `server/src/index.ts`, `web/src/components/EmptyDashboard.tsx`, `web/src/lib/api.ts`
**Estimate:** small
**Dependencies:** m5p1-notes-schema-editor
**Smoke steps:**
1. Add notes to 2+ nodes via the editor.
2. Open the dashboard — both rows appear in the new panel with name + type + preview.
3. Click a row → graph modal opens with that node's detail panel focused.
4. Edit the note; close and re-open dashboard → preview reflects the edit.
5. Delete all notes → empty-state copy renders.

---

**Status:** pending
**Started:** —

## Notes
