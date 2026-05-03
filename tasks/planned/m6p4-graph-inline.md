# Graph view as main panel

**Why:** Final M6 piece. The existing graph-as-modal pattern was a quick hack; the inline main-panel approach is consistent with how every other surface (chat, dashboard, notes) lives in the main panel. Also unblocks the "Edit note" button on the graph's detail panel — without a Notes view to navigate to, that button had nowhere to land.
**What:** When `Knowledge Graph` is selected in the sidebar, the main panel renders the `GraphView` inline (no overlay, no ESC-to-close, no full-screen modal chrome). The Sigma surface fills the main panel; the existing detail panel stays on the right side of the graph but is **bigger by default** (e.g. `w-96` on lg+, `w-[28rem]` on xl+). The detail panel's note section becomes preview-only — markdown rendered inline, no textarea, no save button. An `Edit note` button at the top of the note section navigates to the Notes view, expands the folder tree to wherever the note lives (or root if unfiled), selects the note, and switches the main panel into split-edit mode in one shot. This requires NotesSidebar's tree state (which folders are expanded) to accept an external "expand-to-this-note" command — extend the existing API. While in graph view, the memory panel stays hidden (graph isn't a chat). Existing graph behaviors (hover highlights, filter chips, click-to-detail, color-by-type, FA2 layout) are preserved verbatim. The header `Network` icon was already retired in `m6p1-sidebar-sections`; this story removes the modal scaffolding from `App.tsx` and `GraphView.tsx`.
**Files:** `web/src/App.tsx`, `web/src/components/GraphView.tsx`, `web/src/components/NotesView.tsx`, `web/src/components/NotesSidebar.tsx`
**Estimate:** large — inline transition + bigger panel + Edit-nav cross-component plumbing
**Dependencies:** m6p2-notes-view-shell, m6p2-note-name-field, m6p3-folder-schema
**Smoke steps:**
1. `npm run dev`, log in, click `Knowledge Graph` in the sidebar → graph fills the main panel inline, no modal overlay.
2. Hover, click, filter behave identically to the previous modal version.
3. Click a node with a note (e.g. Snickers) → detail panel opens; it's wider than the old modal version. Note section shows a preview-only markdown render.
4. Click the `Edit note` button → main panel transitions to Notes view; secondary sidebar slides out with the note's location selected; main panel is in split-edit mode for that note's body.
5. Edit and blur → save-on-blur fires; navigate back to graph → note section in detail panel reflects the edit on next open.
6. Switch from graph to a chat → memory panel slides in; graph state is torn down cleanly (no zombie Sigma instances in the DOM).
7. Click a node without a note → detail panel shows the note section's empty state with a "create one in the Notes view" hint instead of an `Edit` button.
8. With a `Generic`-typed inline-created node from `m6p2-note-creation-flow` selected: detail panel shows it correctly, `Edit note` button works, the Notes view opens that note in split-edit mode.

---

**Status:** pending
**Started:** —

## Notes
