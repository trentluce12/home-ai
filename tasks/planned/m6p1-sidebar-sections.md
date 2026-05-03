# Sidebar restructure — Agents + Knowledge sections

**Why:** Foundation for M6. Until the sidebar reorganizes, neither Notes view nor inline Knowledge Graph have a home to live in.
**What:** Restructure the left sidebar into two collapsible sections: `Agents` (the existing chat list moves here, no behavior changes) and `Knowledge` (two button rows: `Notes` and `Knowledge Graph`). Each section header has a chevron toggle and persists its expanded/collapsed state in localStorage. The `Network` icon retires from the chat header (its job moves to the `Knowledge Graph` button — which, for this phase only, opens the existing graph modal as a bridge until phase 4 retires the modal). The `Notes` button is wired but no-ops with a toast / placeholder until phase 2. Extract a new `Sidebar.tsx` component holding the section structure; `SessionList.tsx` becomes a child of the Agents section. Visual: section headers use a smaller font + the existing zinc-tone palette; collapsed sections show the header only with a chevron pointing right.
**Files:** `web/src/App.tsx`, `web/src/components/Sidebar.tsx` (new), `web/src/components/SessionList.tsx`
**Estimate:** medium — mechanical restructure, but touches the layout root
**Dependencies:** none
**Smoke steps:**
1. `npm run dev`, log in. Left sidebar shows two collapsible sections — `Agents` (with the existing chat list) and `Knowledge` (with two button rows).
2. Collapse `Agents`, refresh the page → it stays collapsed (localStorage persisted).
3. Click `Knowledge Graph` → existing graph modal opens (bridge behavior). ESC closes.
4. Click `Notes` → placeholder/toast (real view lands phase 2).
5. The header `Network` icon is gone.
6. Existing chat flows still work — click a chat from the Agents section, it loads correctly; "new chat" still resets.

---

**Status:** pending
**Started:** —

## Notes
