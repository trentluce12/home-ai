# home-ai — backlog

Small, shippable improvements. Each story is self-contained — pick any one and ship it without touching the others. Estimates are rough; bias toward "could do in an evening."

## UI

### 1. Stop streaming
**Why:** Long answers can't be cut short right now.
**What:** Show a stop icon in place of the send arrow while `streaming === true`. Clicking it calls `AbortController.abort()` on the in-flight fetch; keep whatever text streamed in. Server side already terminates cleanly when the SSE consumer disconnects.
**Files:** `web/src/App.tsx`.
**Estimate:** 30 min.

### 2. Copy assistant message
**Why:** Pulling text out of a chat for paste-elsewhere is awkward.
**What:** On hover of an assistant bubble, show a tiny copy button (top-right of the bubble). Click → `navigator.clipboard.writeText(content)`, brief checkmark feedback.
**Files:** `web/src/components/MessageBubble.tsx`.
**Estimate:** 20 min.

### 3. Smart auto-scroll
**Why:** Right now every new chunk forces the view to bottom even if the user has scrolled up to read earlier turns.
**What:** Track whether the scroll container is near the bottom (within ~80px). Only auto-scroll on new content if it is. Add a "↓ jump to latest" pill that appears when not near bottom and there's new content below.
**Files:** `web/src/App.tsx` (the `useEffect` on `[messages]`).
**Estimate:** 45 min.

### 4. Graph search
**Why:** With ~50+ nodes, finding a specific one is annoying.
**What:** Small text input in the graph view header. Type-ahead matches node names; pick → camera centers on that node and the detail panel opens. Sigma has `getNodePosition()` and `camera.animate()`.
**Files:** `web/src/components/GraphView.tsx`.
**Estimate:** 1 hr.

### 5. Recent edges in the dashboard
**Why:** "Recent" only shows nodes — but the interesting signal is often "what *relationship* did I just learn?"
**What:** Add a second list under "recent" titled "recent connections": last N edges with their endpoints, ordered by `created_at`. New endpoint `GET /kg/recent-edges?limit=N`. Render compactly: `user OWNS Snickers · just now`.
**Files:** `server/src/index.ts`, `server/src/kg/db.ts` (one helper), `web/src/components/EmptyDashboard.tsx`, `web/src/lib/api.ts`.
**Estimate:** 45 min.

### 6. Session rename
**Why:** Auto-titled from the first prompt — fine until two chats start the same way.
**What:** On hover or right-click in the session list, show a pencil icon → inline editable input. Submit → call SDK's `renameSession(id, newTitle, { dir, sessionStore })`. Wire a new `PATCH /sessions/:id` endpoint.
**Files:** `server/src/index.ts`, `web/src/components/SessionList.tsx`, `web/src/lib/api.ts`.
**Estimate:** 1 hr.

### 7. Token + cost readout
**Why:** No visibility into per-turn cost or cache hit rate, even though the server already logs both.
**What:** When a turn finishes (`done` event), accumulate `usage.input_tokens / output_tokens / cache_read_input_tokens` and `total_cost_usd` in App state per session. Show `$0.012 · 4.2k tokens · 87% cached` as a quiet line in the memory sidebar footer.
**Files:** `web/src/App.tsx`, `web/src/components/MemoryPanel.tsx`.
**Estimate:** 45 min.

### 8. Inspect the injected context
**Why:** Memory sidebar shows root node names but not the actual `<context>` block that was sent. Hard to debug retrieval.
**What:** Make context cards in the sidebar clickable; expand to show the formatted context string. Server needs to forward `subgraph.formatted` in the `context` SSE event (it already builds it, just doesn't send it).
**Files:** `server/src/index.ts` (one line in the SSE event), `web/src/lib/api.ts` (extend `ContextEvent`), `web/src/components/MemoryPanel.tsx`.
**Estimate:** 30 min.

### 9. Saved graph layout
**Why:** Every time the graph opens, FA2 reshapes from a circle. Disorienting if the layout becomes muscle memory.
**What:** After FA2 settles (~4s), snapshot each node's `(x, y)` and persist to a new `node_layout(node_id PK FK, x REAL, y REAL, updated_at)` table. On next open, hydrate coords before rendering and skip FA2 (or run with very low scaling so it only nudges new nodes into place).
**Files:** `server/src/kg/db.ts` (schema + helpers), `server/src/index.ts` (endpoint to read/write), `web/src/components/GraphView.tsx`.
**Estimate:** 1.5 hr.

## Capabilities

### 10. Ground the "what can you do?" answer
**Why:** Asked once during M3 testing, the model invented Gmail / Calendar / Drive / Supabase / scheduling integrations. None exist. Hurts trust.
**What:** Add a "YOUR ACTUAL CAPABILITIES" section to the system prompt listing the literal tool surface (chat, KG read/write, file system, web fetch/search, Bash). Say explicitly: "Don't claim integrations or features not in this list."
**Files:** `server/src/index.ts` (SYSTEM_PROMPT).
**Estimate:** 15 min.

### 11. Re-embed on `update_node`
**Why:** Renaming a node leaves its embedding pointing at the old text. Documented as deferred in the M3 design log.
**What:** In the `update_node` tool handler (or `kg.updateNode` itself), if the name changed, call `embedNode(updatedNode)` afterwards. Failure should warn-and-continue, not crash the tool.
**Files:** `server/src/kg/tools.ts` (or `db.ts`).
**Estimate:** 20 min.

### 12. Manual fact entry on the dashboard
**Why:** No way to enter a fact without going through chat. Useful for bulk seeding personal context.
**What:** Mirror the forget form: a small "add a fact" section with three inputs (`a name`, `edge type`, `b name`) and type pickers (dropdowns of `NODE_TYPES` and `EDGE_TYPES` from `db.ts`). On submit, POST to `/kg/record-fact`. Server inserts via `link()` + provenance source: `user_statement`, then embeds.
**Files:** `server/src/index.ts`, `web/src/components/EmptyDashboard.tsx`, `web/src/lib/api.ts`.
**Estimate:** 1.5 hr.

### 13. Smart conversation titles
**Why:** First-prompt titles are noisy ("hey", "what's my dog's name?"). Two turns in, you have enough to summarize.
**What:** After turn 2 (or on `done` of any turn if no custom title yet), make a tiny side-call to Claude: "Summarize this conversation in 4–6 words." Store via SDK's `renameSession`. Skip if the session has a `customTitle` already.
**Files:** `server/src/index.ts`.
**Estimate:** 1 hr.

### 14. Per-message cost in the sidebar
**Why:** Story 7 gives a session total. This gives per-turn detail.
**What:** Each `tool_use` / `context` card already shows in chronological order. Add a `done` card after each turn showing tokens + cost for that turn specifically. Keep it visually quiet (no border, just a one-line footnote).
**Files:** `web/src/lib/api.ts` (extend MemoryEvent), `web/src/App.tsx` (handle `done`), `web/src/components/MemoryPanel.tsx`.
**Estimate:** 30 min. (Combine with story 7 for ~1 hr total.)
