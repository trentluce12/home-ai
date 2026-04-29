# home-ai — milestones

## M0 — chat (current, shipped)

- [x] Vite + React + TS + Tailwind frontend
- [x] Hono + Anthropic SDK backend with SSE streaming
- [x] npm workspaces; `npm run dev` boots both
- [x] Dark monochrome aesthetic, Geist fonts, pulsing cursor
- [x] Conversation history sent on each turn (stateless backend)
- [x] Project scaffolding: `.claude/settings.json`, `/check`, `docs/`

Verified: chat works end-to-end with streaming.

## M1 — knowledge graph + self-learning tools (shipped ✓)

- [x] SQLite database in `data/kg.sqlite` via `better-sqlite3`
- [x] Schema: `nodes`, `edges`, `nodes_fts`, `provenance`
- [x] KG tools registered as `mcp__kg__*`: `search`, `get`, `neighbors`, `add_node`, `add_edge`, `link`, `update_node`, `recent`, `stats`
- [x] Agent SDK `query()` loop on the backend with built-ins (Bash, Read, Write, Edit, Glob, Grep, WebFetch, WebSearch) enabled
- [x] System prompt extended with home-ai persona + self-learning + lookup guidance
- [x] UI sidebar ("memory" panel) streams tool activity from SSE
- [x] Smoke test passed: "I have a dog named Lily" → Person, Pet, OWNS edge in KG

**SDK**: Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) with `permissionMode: "bypassPermissions"` for the personal-trusted environment. See `docs/design.md`.

## M2 — passive subgraph injection (shipped ✓)

- [x] On each turn: FTS search over the user's prompt → expand 1 hop → format as compact context block
- [x] Inject by wrapping the user message in a `<context>` block (cache-friendly — system prompt prefix stays stable for M3)
- [x] Cap subgraph size (20-node hard cap; token cap deferred until embeddings land in M3)
- [x] UI: sidebar shows context retrievals (sky dot) alongside tool calls (emerald/zinc), with `Nn / Me` counts
- [x] Switched from stateless transcripts to Agent SDK session resumption (`resume: sessionId`); frontend tracks sessionId across turns
- [x] Enabled `includePartialMessages` — text now streams token-by-token via `stream_event` deltas
- [x] Smoke test: with "user OWNS Snickers" seeded, "what's my dog's name?" answers from injected context without a `search` tool call

## M3 — embeddings + hybrid retrieval (shipped ✓)

- [x] `node_embeddings(node_id PK, model, vector BLOB, dim, updated_at)` table; Float32Array packed BLOB; FK cascade on node delete
- [x] Voyage `voyage-3-large` provider, `input_type: "document"` for nodes / `"query"` for user messages; `VOYAGE_API_KEY` from `.env`
- [x] Hybrid retrieval: FTS rank list + cosine rank list → Reciprocal Rank Fusion (k=60) → top-K → 1-hop expansion. In-memory cosine over rehydrated vectors (swap to `sqlite-vec` when KG > ~10K nodes).
- [x] Embedding failures (Voyage 5xx, missing key, quota) are non-fatal at retrieval time: server logs and falls back to FTS-only.
- [x] Provenance: every node/edge created via tools or seed writes a row to `provenance` (source ∈ `user_statement | agent_inference | seed`). Edges carry confidence: 1.0 for user-stated/seed, 0.5 default for inferred.
- [x] `link` tool replaced with `record_user_fact` (high confidence) and `record_inferred_fact` (low confidence, optional override). System prompt teaches the heuristic — direct assertion vs. derived guess.
- [x] Cache observability: server logs `cache_create`/`cache_read` token counts on each result. Subgraph already lives in the user message (M2), so the `system + tools` prefix stays cache-eligible.
- [x] Smoke test: "what's the name of my pet?" (no token overlap with "Snickers") returns "Snickers" with no `search` tool call; sidebar shows context retrieval.
- [x] `cache_read_input_tokens > 0` on the second turn of a session.

## M4 — quality of life

Split into three phases; each ships independently.

### Phase 1 — sessions, dashboard, markdown (shipped ✓)

- [x] Multi-session persistence: left sidebar lists past chats (via Agent SDK `listSessions`), click to load history (`getSessionMessages`), "new chat" button starts fresh, hover→delete
- [x] Empty-state dashboard (replaces the slash-command pattern): when there are no messages in view, the chat area shows live KG stats + recent nodes + a forget input + export buttons. Disappears once chatting starts; reappears via "new chat".
- [x] KG endpoints added (`/kg/recent`, `/kg/stats`, `/kg/by-name`, `/kg/node/:id`, `/kg/export?format=json|dot`) — same surface, now consumed by the dashboard.
- [x] Backups / export — JSON (full snapshot minus embeddings) + Graphviz `.dot`, both as downloadable files via dashboard buttons.
- [x] Forget flow shows the node + every edge that would die before confirming, then deletes with provenance cleanup in a transaction.
- [x] Markdown rendering on assistant messages via `react-markdown` + `remark-gfm` + Tailwind typography (`prose-invert`); inline streaming cursor dropped in favor of the existing header indicator.
- [x] Layout reshuffled to 3 columns (chats / chat / memory) on `lg+`; smaller breakpoints hide both sidebars.
- [x] Smoke tests: dashboard loads with seeded counts, forget flow works, markdown renders, sessions sidebar persists across refresh, SessionStore adapter writes show up in `data/kg.sqlite`.

### Phase 2 — graph visualization (locked, not started)

- [ ] sigma.js panel (chosen for long-term scaling vs react-force-graph) — toggleable view of the KG, live-updates on new facts
- [ ] `GET /kg/graph` endpoint returning sigma-friendly node/edge shapes

### Phase 3 — bulk import (deferred)

- [ ] JSON import (accepts the export shape)
- [ ] Obsidian markdown ingestion (likely via the agent itself in a one-off flow rather than a structured importer)
