# Notes view shell + secondary sidebar

**Why:** First half of phase 2. Stand up the Notes browse-and-view surface so phase 2's later stories (note name field, inline creation) have a home. Folders don't exist yet — every note is a flat-list entry.
**What:** Selecting `Notes` in the primary sidebar slides a secondary sidebar out from the left edge of the primary nav, holding a flat list of all notes (no folder hierarchy yet — folder support lands in phase 3). Click a note row → main panel transitions to a preview-only view (existing `react-markdown` + `prose-invert` rendering, with the note's existing display name as a header). Preview view has an `Edit` button that switches the main panel to a split layout: editor textarea on the left, live preview on the right (no save button — same save-on-blur behavior as the existing per-node editor). When `Notes` is active and no specific note is selected, the main panel shows a notes-context dashboard variant (the existing `EmptyDashboard` widget set, but emphasizing the recent-notes panel — agents-context KG widgets like forget/import shrink or hide). Closing the secondary sidebar (X button or click `Notes` again) returns to the agents-context dashboard.
**Files:** `web/src/App.tsx`, `web/src/components/NotesView.tsx` (new), `web/src/components/NotesSidebar.tsx` (new), `web/src/components/EmptyDashboard.tsx`, `web/src/lib/api.ts`
**Estimate:** large — new view component, new secondary sidebar, layout state machine
**Dependencies:** m6p1-sidebar-sections
**Smoke steps:**
1. `npm run dev`, log in, click `Notes` in the sidebar → secondary sidebar slides out from the left of the primary nav, listing the 4 seeded notes (Snickers / home-ai / TypeScript / Knowledge graphs).
2. Main panel shows the notes-context dashboard variant (recent-notes panel prominent).
3. Click `home-ai` row → main panel transitions to a preview-only render of the markdown body. `Edit` button visible top-right.
4. Click `Edit` → split view: textarea on the left with the raw body, live `react-markdown` preview on the right.
5. Edit the body, click outside → save-on-blur fires (status indicator), reload the page, click `home-ai` again → edit persists.
6. Click `Notes` button again → secondary sidebar collapses; main panel returns to the agents-context dashboard.
7. Open a chat → notes view tears down cleanly; memory panel slides back in.

---

**Status:** pending
**Started:** —

## Notes
