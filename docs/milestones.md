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

- [x] Multi-session persistence: left sidebar lists past chats, click to load history, "new chat" button starts fresh, hover→delete. Sessions are stored in SQLite via a `SessionStore` adapter (instead of the SDK's filesystem JSONL default), so the entire app state lives in `data/kg.sqlite` — single backup target, single source of truth.
- [x] Retention sweeper: at server boot, sessions idle > `SESSION_ARCHIVE_DAYS` (default 30) are flagged `archived_at` (hidden from the sidebar by default); idle > `SESSION_DELETE_DAYS` (default 180) are deleted entirely. Both env-configurable; pass 0 to disable a step.
- [x] Migration script `npm --workspace server run migrate-sessions` imports any pre-existing JSONL sessions (including ones orphaned under the workspace dir's project key) into the DB.
- [x] Empty-state dashboard (replaces the slash-command pattern): when there are no messages in view, the chat area shows live KG stats + recent nodes + a forget input + export buttons. Disappears once chatting starts; reappears via "new chat".
- [x] KG endpoints added (`/kg/recent`, `/kg/stats`, `/kg/by-name`, `/kg/node/:id`, `/kg/export?format=json|dot`) — same surface, now consumed by the dashboard.
- [x] Backups / export — JSON (full snapshot minus embeddings) + Graphviz `.dot`, both as downloadable files via dashboard buttons.
- [x] Forget flow shows the node + every edge that would die before confirming, then deletes with provenance cleanup in a transaction.
- [x] Markdown rendering on assistant messages via `react-markdown` + `remark-gfm` + Tailwind typography (`prose-invert`); inline streaming cursor dropped in favor of the existing header indicator.
- [x] Layout reshuffled to 3 columns (chats / chat / memory) on `lg+`; smaller breakpoints hide both sidebars.
- [x] Smoke tests: dashboard loads with seeded counts, forget flow works, markdown renders, sessions sidebar persists across refresh, SessionStore adapter writes show up in `data/kg.sqlite`.

### Phase 2 — graph visualization (shipped ✓)

- [x] Sigma.js + graphology with FA2 worker layout (animated for ~4s on open, then settles).
- [x] Full-screen modal opened via a Network icon in the header. ESC closes.
- [x] Hover a node → highlight neighborhood (everything else dims, non-incident edges hide). Click → side panel with props, neighbors, provenance.
- [x] Filter chips per entity type along the top — toggle to hide/show.
- [x] Color-coded by entity type (Person/Pet/Project/Topic/Organization/etc.); node size scales with degree so hubs stand out.
- [x] `GET /kg/graph` returns `{nodes: [{id, name, type}], edges: [{id, fromId, toId, type}]}`. `GET /kg/node/:id` returns `{node, neighbors, provenance}` for the detail panel.
- [x] Refresh: re-fetched on every modal open + on every `done` SSE event from /chat (so new facts show up live if the modal is open).
- [x] Seed expanded to 17 nodes / 20 edges (project + tech stack + service providers + topic space) so the graph isn't a single dot.
- [x] Smoke tests: graph opens with FA2 settling, hover highlights, click opens detail panel, filter chips hide/show types, live-refreshes on chat completion.

### Phase 3 — bulk import (shipped ✓)

- [x] JSON KG import endpoint (`POST /api/kg/import`): accepts the export shape, inserts nodes/edges under a new `bulk_import` provenance source, default skip-merge on `(name, type)` collision, opt-in replace-all wipes first. Single transaction with fresh IDs and edges rewired via id-map; background re-embed of inserted nodes.
- [x] Dashboard "Import" section: file picker + replace-all checkbox + browser `confirm()` gate. Round-trips the JSON export — useful for backup restore and cross-machine migration.
- [x] Obsidian-vault ingestion via system-prompt flow: chat agent walks a vault with `Read`+`Glob`, calls `mcp__kg__record_user_fact`, uses `mcp__kg__neighbors` to dedupe before insert. Triggered by `/import-obsidian <path>` or free-form request. Companion `.claude/commands/import-obsidian.md` reference card.

Smoke tests: JSON round-trip (default-merge skips known nodes, replace-all reseeds the snapshot, transactional rollback on partial failure). Obsidian flow is manual — exercise via chat with a real vault path.

## M4.5 — production deployment + auth (shipped ✓)

- [x] `auth_sessions` table + token store (`server/src/auth/store.ts`); idle expiry tracked in DB so restarts don't drop logins.
- [x] `/api/*` route prefix — clean split between SPA paths and API. Dev CORS scoped to `:5173`; prod is same-origin so CORS is off.
- [x] Password auth: `POST /api/auth/login` checks bcrypt against `HOME_AI_PASSWORD_HASH`, mints a session, sets HttpOnly cookie. `POST /api/auth/logout` revokes. `GET /api/auth/me` reports state. Per-IP rate limit (5 / 15 min).
- [x] Auth middleware on `/api/*` (passes `/api/auth/*` through unauthed); 401 on missing/expired cookie.
- [x] Login page at `/login` (web/src/pages/Login.tsx) — gated route, redirects to `/` on success.
- [x] Static serving in production: `serveStatic` mounts `web/dist`, SPA fallback to `index.html` for non-`/api/*` paths so client routes hydrate.
- [x] Tool narrowing (`HOME_AI_ALLOW_WRITE_TOOLS`): default prod allowlist excludes `Bash`/`Write`/`Edit`, leaving KG tools + `Read`/`Glob`/`Grep`/`WebFetch`/`WebSearch`. Opt back in for local dev.
- [x] Multi-stage Dockerfile (node:22-alpine), runs as `node` user, read-only root FS, `/data` the only writable mount, `wget`-based healthcheck on `GET /`.
- [x] `docker-compose.yml` mirrors prod posture: read-only root, tmpfs `/tmp`, cap_drop ALL, no-new-privileges, named `home-ai-data` volume.
- [x] README "Deploy" section: env var reference, bcrypt recipe, `docker compose up`, `/data` backup recipe.

Smoke test: `docker compose up` on a clean machine, set env, hit URL, log in, send a chat, kill container, recreate, KG and sessions persist.

## M5 — node-attached notes layer (planned)

Free-form markdown notes attached 1:1 to KG nodes. Long-form context that doesn't fit edge form, with on-demand retrieval, agent-write tooling gated by an approval modal, and a browsing surface. Design landed 2026-05-03 in `docs/design.md`.

Phased like M4 — three phases, six stories tracked in `tasks/planned/`.

### Phase 1 — manual notes baseline (planned)

- [ ] `m5p1-notes-schema-editor` — `node_notes` table + GET/PUT API + markdown editor inside the existing node detail panel.
- [ ] `m5p1-notes-panel` — top-level "Notes" surface in the empty-state dashboard (flat list of nodes with notes; click → opens detail panel).
- [ ] `m5p1-notes-retrieval` — `notePreview` snippet alongside retrieved nodes + `mcp__kg__get_node_note` tool for full body.

### Phase 2 — approval modal + agent edits (planned)

- [ ] `m5p2-approval-modal` — SSE `approval_request` event + response endpoint + reusable Approve/Deny/Tweak modal infrastructure.
- [ ] `m5p2-propose-note-edit` — first consumer: agent rewrites notes through the modal.

### Phase 3 — node merge (planned)

- [ ] `m5p3-propose-node-merge` — collapse N duplicate nodes into 1 (edges deduped, body unified, embeddings regenerated, provenance rewritten, source nodes dropped) in one transaction. Most complex tool; lands on its own.
