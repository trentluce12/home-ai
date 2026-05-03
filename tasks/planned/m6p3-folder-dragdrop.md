# Folder drag-and-drop

**Why:** Right-click + Move-to is workable but slow for the natural "put this note in that folder" gesture. VSCode parity expects drag-and-drop for re-parenting.
**What:** HTML5 drag-and-drop on tree rows in `NotesSidebar` (no react-dnd or external lib — native API is enough for this surface). Drag a note row onto a folder row → drops the note into that folder (PATCH /api/kg/node/:id/note with folderId). Drag a folder row onto another folder row → re-nests (PATCH /api/kg/folders/:id with parentId). Drag onto the empty space below the tree (or onto an explicit "Unfiled" drop zone at the top of the sidebar) → moves to root (folderId = null). Visual: dragging row gets `opacity-50`; valid drop targets highlight with a `bg-zinc-800` ring on hover. Invalid drops (folder onto its own descendant — would create a cycle) reject with a brief shake animation + toast. While dragging, deeper folder rows are auto-expanded after a 600ms hover (VSCode's "spring-loaded folders") so the user can drop into nested locations without clicking-to-expand first. Reordering siblings via drag is **not in scope** for this story — sort_order edits land via a future story or via dragging-to-reorder once the desire surfaces (the right-click menu doesn't expose reorder either; we leave it sort-by-name for now).
**Files:** `web/src/components/NotesSidebar.tsx`
**Estimate:** medium — HTML5 drag/drop is finicky but contained to one component
**Dependencies:** m6p3-folder-crud
**Smoke steps:**
1. `npm run dev`, log in, open Notes. Create two folders + a few notes via the right-click menu.
2. Drag a note from root onto a folder → on hover, folder row highlights; on drop, note moves into the folder; tree re-renders.
3. Drag a folder onto another folder → re-nests cleanly.
4. Drag a deeply-nested note up to the root drop zone → un-files it (folderId = null).
5. Hover a collapsed folder while dragging → after ~600ms it auto-expands, allowing nested drops.
6. Try to drag a folder onto its own child → drop is rejected with shake + toast; folder structure unchanged.
7. Drag-and-drop while another user-action is in flight (e.g., during an inline-rename of a third row) → both ops complete cleanly, no race.

---

**Status:** pending
**Started:** —

## Notes
