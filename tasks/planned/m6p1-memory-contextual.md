# Memory panel demoted to contextual chat-only

**Why:** Memory always-visible eats reading room when the user isn't actively chatting (browsing notes, viewing graph, on the dashboard). With the new layout, memory becomes a chat-companion thing.
**What:** Memory panel is hidden by default; slides in from the right when the user is viewing an active chat session (any session with messages). Slide-in is a quick (~150ms) transform animation, not a fade. The panel header gains an `X` close button (collapses with the same animation in reverse) and a left-edge drag handle for resizing (between `w-56` min and `w-96` max; persisted to localStorage). Once the user leaves the chat (selects a different session, opens Notes/Graph, lands on the empty-state dashboard via "new chat"), the panel hides again. If the user explicitly closed it during a chat, that closed-state persists for the rest of the session — re-opens on next browser load (so the friction tax isn't permanent).
**Files:** `web/src/App.tsx`, `web/src/components/MemoryPanel.tsx`
**Estimate:** medium — animation + resize-drag is fiddly, but no backend touch
**Dependencies:** m6p1-sidebar-sections
**Smoke steps:**
1. `npm run dev`, log in, land on the empty-state dashboard → memory panel is hidden.
2. Click an existing chat with messages → memory panel slides in from the right at the persisted width (default `w-72`).
3. Drag the left-edge handle to resize → snaps within bounds; refresh the page, re-enter the chat → resized width persists.
4. Click the `X` → panel slides out; refresh the page, re-enter the same chat → panel stays collapsed (per-session sticky-closed).
5. Open a new browser tab/window → panel re-opens at the persisted width on entering a chat.
6. Open Notes / Knowledge Graph view → panel hides; return to chat → panel comes back (or stays collapsed, per #4).

---

**Status:** pending
**Started:** —

## Notes
