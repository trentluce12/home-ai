# home-ai — design

A personal AI: streaming chat UI on top of the Anthropic API. Knowledge graph context lands in M1.

## Architecture

- **`web/`** — Vite + React + TS + Tailwind. Single chat surface. POSTs to `/chat`, consumes SSE.
- **`server/`** — Hono + `@anthropic-ai/sdk`. `/chat` opens an SSE stream, calls `messages.stream()`, forwards text deltas to the browser.
- **Workspace** — npm workspaces; `concurrently` runs both dev servers under `npm run dev`. `dotenv` loads `.env` from project root via an explicit relative path (workspaces cd into the workspace dir, so cwd-based loading would miss it).

## Decisions

Newest first. Append entries; don't edit history.

### 2026-04-28 · M4 phase 2 — sigma.js memory graph

Full-screen graph viz, opened via a Network icon in the header. New `GraphView` component is self-contained: fetches `/kg/graph` on open (and on every chat-completion `done` if the modal is up), builds a `graphology` Graph, places nodes with the circular layout helper, then runs `FA2Layout` (the worker variant) for ~4 seconds before stopping the simulation.

**Stack call.** Sigma + graphology + graphology-layout + graphology-layout-forceatlas2 (worker entry). All authored under the same umbrella; the worker version keeps the layout off the main thread so the UI stays responsive while FA2 settles. Picked sigma over react-force-graph because the user wants headroom — sigma's WebGL-canvas split scales further than react-force-graph's pure-canvas approach.

**Visual encoding.** Each entity type gets a color (Person/Pet/Project/Topic/Organization/etc.). Node radius = `4 + min(degree * 1.4, 14)` so hubs (the user node, home-ai) read as central. Edges show their type as a label, drawn faintly to keep the foreground readable.

**Interaction.**
- Click a node → fetch `/kg/node/:id` and slide a side panel in with props, neighbors, and provenance.
- Hover a node → `nodeReducer`/`edgeReducer` dim everything outside the 1-hop neighborhood and hide non-incident edges. Refresh on enter/leave.
- Filter chips per entity type at the top — clicking toggles a `hidden` Set. Re-renders the graph minus that type, edges incident to hidden nodes are dropped automatically.

**Backend.** Two endpoints:
- `GET /kg/graph` — flat `{nodes: [{id, name, type}], edges: [{id, fromId, toId, type}]}`. Embeddings and props left out — node detail comes from a separate fetch on click.
- `GET /kg/node/:id` — `{node, neighbors, provenance}` for the detail panel. Provenance read directly from the table (no API for it before).

**Seed expanded.** From 1 fact (`user OWNS Snickers`) to 20 — added `home-ai` as a Project, the tech stack as Topics with `DEPENDS_ON` edges, Anthropic + Voyage AI as Organizations, and the conceptual neighborhood (Knowledge graphs / Personal AI / RAG / Embeddings) as Topics with `RELATES_TO`. All facts are derivable from the codebase — no fabricated personal info. A clearly-marked block at the bottom of `seed.ts` invites the user to paste real personal facts (family, employer, places, preferences) which the inferred-from-codebase facts can't supply.

**Deferred.**
- Search box (jump to a node by name).
- Saved layout coordinates (so the graph doesn't reshape every open).
- Edge filtering by type (currently only nodes filter; cascade through edges).
- Subgraph view (focus on a single node + N-hop neighborhood).

### 2026-04-28 · M4 phase 1.5 — sessions move into SQLite via SessionStore adapter

The cwd-encoding incident (sessions saved under `C--Projects-home-ai-server` because npm workspaces start the server with `cwd = server/` and `listSessions({dir})` derives a different project key) made the filesystem-backed storage feel fragile. Pivoted to the SDK's `SessionStore` adapter interface: app owns the storage, SDK uses our adapter for read/resume/list/delete.

**Architecture.** The SDK does dual-write — `query({ sessionStore })` still writes to `~/.claude/projects/...` AND emits entries to our adapter. The filesystem becomes a redundant local copy; our SQLite is the source of truth for everything the app reads. `listSessions / getSessionMessages / deleteSession` all accept `sessionStore` and bypass the filesystem on the read path.

**Schema (in `kg/db.ts`):**
- `sessions(project_key, session_id, created_at, last_active, archived_at, summary_json)` — composite PK on `(project_key, session_id)`. `summary_json` is a sidecar maintained by the SDK's `foldSessionSummary` helper; we store it verbatim.
- `session_entries(id PK AUTOINCREMENT, project_key, session_id, subpath, uuid, type, timestamp, payload_json)` — opaque JSON pass-through. `id` provides the chronological ordering the SDK contract requires. Partial unique index on `uuid WHERE uuid IS NOT NULL` enforces idempotency for entries with one (the SDK contract says non-uuid entries — titles, tags, mode markers — bypass dedup).

**Adapter (`server/src/sessions/store.ts`).** Implements `append / load / listSessions / listSessionSummaries / delete / listSubkeys`. `append` runs in a transaction: upsert session row → INSERT OR IGNORE entries → recompute summary via `foldSessionSummary` and persist it. `load` returns null for missing sessions (the contract distinguishes "never written" from "emptied").

**Retention.** New module `sessions/cleanup.ts`. At server boot, archive sessions idle > `SESSION_ARCHIVE_DAYS` (default 30) and delete sessions idle > `SESSION_DELETE_DAYS` (default 180). Pass 0 to disable either step. Archived sessions stay resumable but are filtered out of the default sidebar (`/sessions?includeArchived=true` to opt back in). FK cascade drops their entries on delete.

**Migration.** New script `npm --workspace server run migrate-sessions` reads JSONL files from any of the legacy project keys (`C--Projects-home-ai`, `C--Projects-home-ai-server`, `C--Projects-home-ai-web`) and re-`append()`s them under the canonical key (`C--Projects-home-ai`). Re-keying lets the orphaned 8 sessions show up alongside new ones. Custom-built rather than using `importSessionToStore` because the latter doesn't support cross-project re-keying.

**Why @alpha is OK here.** The `SessionStore` interface is annotated alpha but the contract for adapters is opaque-JSON pass-through — round-tripping `JSON.stringify`/`JSON.parse` is the only invariant. Internal entry shapes can change; we don't introspect them. Only `foldSessionSummary` and the `SessionSummaryEntry.data` field are SDK-internal — we treat the latter as opaque too.

**Deferred.** `CLAUDE_CONFIG_DIR=/tmp` to drop persistent filesystem copies entirely. For now, dual-write keeps the JSONL as a safety net; flip it later when the adapter has weeks of stable use.

### 2026-04-28 · M4 phase 1 — sessions, slash commands, markdown rendering

Three loosely-related QoL items shipped together because they share UI surface (sidebar layout, modal infra, message rendering).

**Multi-session persistence.** The Agent SDK already persists every session as JSONL under `~/.claude/projects/<encoded-project-dir>/<session-id>.jsonl`. We just hadn't been using it. Three new endpoints expose the SDK's session primitives — `listSessions({ dir: PROJECT_DIR })`, `getSessionMessages(id, { dir })`, `deleteSession(id, { dir })` — and the frontend stitches them together: left sidebar lists past chats, clicking loads the history into `messages` state, "new chat" clears the slate.

History replay needed one wrinkle: the saved user messages contain the M2 `<context>...</context>` wrap. We strip that on the way out (`stripContext`) so the user sees what they actually typed, not the injection. `firstPrompt` from `SDKSessionInfo` gets the same treatment for the chat title.

**Why multi-session over single thread.** Considered a single continuous thread (simpler) but went with multi because the user wanted to keep distinct conversations distinct (planning a trip, debugging code, etc.). Cheap to add, no real downside.

**Empty-state dashboard (pivoted away from slash commands).** Original M4 design had `/recent`, `/stats`, `/forget <name>`, `/export` typed into the chat input → opening a modal. Implemented and typechecking, then pivoted on review: the user pointed out that Claude Code's pre-session view is a more discoverable pattern. Replaced the modal with an `EmptyDashboard` component that occupies the chat area whenever `messages.length === 0`:

- **stats + recent** are auto-loaded on mount (no command needed); the section refreshes via a `refreshKey` bump after any forget or chat completion.
- **forget** is a fill-in input + button: type a name → Find → inline confirmation panel listing every match plus its neighbors → per-match Forget button. Same deletion path (provenance cleanup in a transaction) as the modal had.
- **export** is two buttons (JSON / Graphviz `.dot`); embeddings excluded.
- The dashboard disappears once the conversation starts; clicking "new chat" in the sessions sidebar brings it back.

The `SlashCommandModal` component, parser, and slash-routing in `send()` were deleted — no command parsing in the input layer at all now. Typing `/anything` just sends to chat. The KG endpoints (`/kg/recent`, `/kg/stats`, `/kg/by-name`, `/kg/node/:id`, `/kg/export`) didn't change; only the consumer did.

**Why the pivot.** Discoverability. A blank "what's on your mind?" screen tells the user nothing about what `home-ai` actually remembers; the dashboard makes the state of the system part of the empty surface. The slash-command pattern works for power users who already know the commands, but a personal AI's first-time-of-the-day experience benefits from showing rather than gating.

**Markdown rendering.** Assistant messages now go through `react-markdown` + `remark-gfm` with the Tailwind typography plugin's `prose-invert` styling (with overrides for our color palette). The inline streaming cursor was dropped — the header "thinking…" indicator already covers the streaming feedback role, and reconciling a trailing cursor with a markdown-rendered tree is a fight for marginal value.

**Layout.** Three columns at `lg+`: sessions (288px) / chat (flex) / memory (288px). Smaller breakpoints hide both sidebars and show only the chat. Mobile UX still isn't a focus.

**Component split.** App.tsx had been fine as one file through M3 but was about to balloon. Pulled `MessageBubble`, `MemoryPanel`, `SessionList`, and `SlashCommandModal` into `web/src/components/`, plus a small `web/src/lib/api.ts` for fetch helpers and shared types. Tradeoff is a few more files; benefit is App.tsx stays an orchestrator.

**Deferred to phase 2.** Graph visualization (sigma.js, locked in). Phase 3 — bulk import — is on hold until there's actually a corpus worth importing.

### 2026-04-28 · M3 — Voyage embeddings + RRF hybrid retrieval + provenance

**Storage.** New `node_embeddings(node_id PK FK, model, vector BLOB, dim, updated_at)` table. Vectors packed as Float32Array bytes. Decode copies into a fresh array to avoid alias-with-buffer pitfalls across rows. FK cascade so deleting a node removes its embedding.

**Provider.** Voyage `voyage-3-large` via `fetch` (no SDK dep). `input_type: "document"` when embedding nodes, `"query"` for user messages — Voyage uses different projections under the hood and the asymmetric mode measurably helps retrieval. Failures bubble up in the seed (intentional — fail loud at dev startup if the key is missing) and are caught + logged at retrieval time (intentional — chat keeps working in FTS-only mode if Voyage has a hiccup).

**Retrieval.** `retrieve.ts` is now async. Per turn:
1. FTS query — tokens joined with \`OR\`, ordered by bm25 \`rank\`.
2. Cosine — embed the user message once, brute-force cosine against every persisted embedding, sort desc.
3. **Reciprocal Rank Fusion** (k=60) over the two ranked id lists. RRF was the right call vs weighted alpha — no normalization, no tuning, robust to either retriever returning weak scores.
4. Top-K fused → 1-hop expand (M2 path) → format.

In-memory cosine is fine until the KG passes ~10K nodes. Swap to `sqlite-vec` when that becomes a real concern.

**Provenance and confidence.** Schema already had a `provenance` table (defined in M1, never written to). M3 fills it. Every node/edge created via the recording tools or the seed gets a row with `source ∈ user_statement | agent_inference | seed`. Edge confidence is set per source: 1.0 for user-stated/seed, 0.5 default for inferred (the agent can override 0–1).

**Tool surface change — `link` split into two.** The agent now calls `record_user_fact` (when the user directly states something) or `record_inferred_fact` (for derivations). System prompt got a recording-section rewrite with examples on each side and explicit "when in doubt, prefer record_user_fact" guidance. Rationale for the split (vs an extended \`link\` with a \`source\` arg): the tool name carries the semantic — there's no way to "accidentally" record an inference as a user fact, and the model's tool-choice behavior matches its assertion confidence cleanly. \`add_node\` and \`add_edge\` were also dropped from the tool surface; they remain as library functions for `seed.ts` and the recording tools to call internally.

**Caching.** M2 already put the subgraph in the user message, so the `system + tools` prefix is naturally cache-eligible. The result handler now logs `cache_creation_input_tokens` and `cache_read_input_tokens` per turn so cache hits are visible in the server log. No SDK knob needed — the Anthropic API caches stable prefixes automatically. Verified live: turn 2 of a session shows `cache_read > 0`.

**Verified live.** "What's the name of my pet?" — zero token overlap with "Snickers" — returns "Snickers" without a `search` tool call. Sidebar shows the context retrieval card. Hybrid retrieval is doing the work FTS-only couldn't.

**Deferred:**
- **Token budget on the subgraph.** Still hard-capped at 20 nodes; real token counting waits until cache hit rates make it matter.
- **Re-embedding on update.** `update_node` currently changes name/props but doesn't refresh the embedding. Easy fix when a name change actually moves retrieval results enough to matter.
- **Embedding cache in process memory.** Each retrieval call rehydrates all embeddings from SQLite. Negligible at current scale; cache when KG growth makes it visible.

### 2026-04-28 · M2 — passive subgraph + session resumption + token streaming

Three changes landed together because they touch the same prompt-construction path.

**Subgraph injection.** New `server/src/kg/retrieve.ts`: tokenize the user message (lowercase, drop stopwords + 1–2 char tokens, dedupe), FTS-search per token (cap 5 root nodes), expand 1 hop via `neighbors`, format as `- name (Type) EDGE name (Type)` lines. Wrap the user message in a `<context>...</context>` block before passing as `prompt`. The system prompt got a new "PASSIVE CONTEXT" section telling the model to trust that block and skip `search` when it's sufficient.

**Why wrap the user message instead of extending the system prompt:** prompt caching in M3. The system prompt + tool definitions are the natural cache prefix; per-turn KG content shoved into the system would invalidate the cache every turn. Wrapping the user message keeps the prefix stable.

**Session resumption.** Dropped the stateless 10-turn transcript hack. Request shape changed from `{messages: ChatMessage[]}` to `{message: string, sessionId?: string}`. Server passes `resume: sessionId` to `query()` when present and emits the session id from `system/init`; frontend stashes it in state and replays on subsequent turns. Side benefit: removes the silent context-loss after turn 10.

**Token streaming.** `includePartialMessages: true` enabled. New `stream_event` case in the SSE pump: forward `content_block_delta` text deltas verbatim. To avoid duplication, the existing `assistant` case stopped emitting text — it now only forwards `tool_use` blocks (which arrive complete in the assistant message anyway, so the sidebar still gets clean events).

**Sidebar.** `toolEvents` → `memoryEvents` (discriminated union of `tool` and `context`). Context cards get a sky-blue dot and an `Nn / Me` counter; tool cards unchanged.

**Deferred (M3 territory):**
- **Token budget for the subgraph.** Hard-capped at 20 nodes for now. Real budgeting waits until we measure what fits inside the cache breakpoint.
- **Better tokenization.** Stopword list is hand-rolled and English-only. Embedding-based retrieval in M3 makes the keyword tokenizer mostly redundant.
- **Conversation persistence across refresh.** Session id lives in React state; refresh wipes it. Easy localStorage stash later, but resume requires the server-side session to still exist (`~/.claude/projects/`) which it does by default.

**Verified live.** Pet-name smoke test passed against the seeded `user → Snickers` fact: the model answers from the injected `<context>` block without calling `mcp__kg__search`.

### 2026-04-28 · Replace `tsx watch` with `node --watch --import tsx`

After fixing the port-zombie issue, `npm run dev` *still* failed silently — the server section of `concurrently` showed no output and HTTP fetches to :3001 timed out. Cause: `tsx watch` on Windows interacts badly with non-TTY stdio (concurrently pipes stdout/stderr); its inner node child doesn't reliably flush output (or in some cases doesn't start at all) when the parent isn't a TTY.

Swapped the server's dev script: `tsx watch src/index.ts` → `node --watch --import tsx src/index.ts`. Same TypeScript handling (tsx as the import hook), but file-watching is now done by Node's native `--watch` flag (Node 20.6+) in a single process — no spawn-child quirk, output flows through concurrently cleanly, Ctrl+C kills the one process. Verified end-to-end via `npm run dev` from a piped shell.

### 2026-04-28 · Auto-clean dev ports before each `npm run dev`

`tsx watch` on Windows leaks its node child process when killed via Ctrl+C from `concurrently`. The leaked process keeps port 3001 bound, so the next `npm run dev` crashes with `EADDRINUSE`. Worse, `concurrently` swallows the stderr from the crashing child — the terminal goes silent and the symptom looks like "the server isn't starting" with no error.

**Fix**: added a `predev` npm hook that runs `kill-port 3001 5173` before `dev`. Adds `kill-port` to root devDeps. Cross-platform; safe to run when ports are free (no-ops). Killed the silent-failure mode in one stroke.

If this bites again on a different port, just append it to the `predev` line.

### 2026-04-28 · M1 shipped — KG + Agent SDK migration

Migrated the backend from `@anthropic-ai/sdk` to `@anthropic-ai/claude-agent-sdk`. Added a SQLite knowledge graph (`data/kg.sqlite`) via `better-sqlite3` + `nanoid`, with `nodes`, `edges`, `nodes_fts`, and `provenance` tables. Schema is soft (text columns; type validation in the repo layer). FTS5 stays in sync via triggers.

KG tools registered as MCP tools under server name `kg` (so the agent sees `mcp__kg__search`, `mcp__kg__link`, etc.):
- Read: `search`, `get`, `neighbors`, `recent`, `stats`
- Write: `add_node`, `add_edge`, `link`, `update_node`

Agent SDK built-ins enabled: `Bash`, `Read`, `Write`, `Edit`, `Glob`, `Grep`, `WebFetch`, `WebSearch`. Permission mode: `bypassPermissions` (personal trusted environment — the agent acts without confirmation).

System prompt extended with the home-ai persona + entity/edge type lists + self-learning guidance ("use `link` when the user shares a fact worth remembering") + lookup guidance ("use `search` before answering personal-context questions").

Frontend gained a "memory" sidebar (`hidden lg:flex`) that streams tool activity off the SSE channel. Each tool call shows up live with a humanized name + compact input summary (`user → Lily [OWNS]`).

**Deferred for M2:**
- **Conversation history**: M1 ships stateless — each `/chat` formats prior turns into the prompt as a transcript. M2 should switch to Agent SDK session resumption (`resume: sessionId`) for cleaner cross-turn state and proper prompt caching.
- **Streaming granularity**: not using `includePartialMessages`, so text arrives in chunks (one per assistant content block) rather than token-by-token. Functional but visibly chunky on long answers.

### 2026-04-28 · MIT license + personal-project posture

Picked MIT for its simplicity and permissiveness — anyone can clone, fork, modify, redistribute (even commercially), provided they keep the copyright notice. Repo is private; license is in place for whenever it goes public or gets shared. README notes that external contributions won't be reviewed — this is a personal project, not a community one.

### 2026-04-28 · Lock in Claude Agent SDK for M1+

Picking `@anthropic-ai/claude-agent-sdk` over staying on the lower-level `@anthropic-ai/sdk` with its tool runner for M1+. M0 stays on the Anthropic SDK (already shipped).

**Why:** Bias toward the richer agent runtime upfront — sub-agents, hooks, MCP integration, and built-in file/bash/web tools — rather than retrofit them later. Slightly more dependency weight and a learning curve, but unlocks capabilities (filesystem awareness, MCP plug-ins, hook-based self-learning post-processing) that align with where home-ai is headed.

**Implications:**
- M1 backend uses `query()` from the Agent SDK to drive the agent loop instead of `client.beta.messages.toolRunner()`
- KG tools registered as user-defined tools alongside the SDK's built-ins
- Built-ins (bash, file ops, web search) become available to the agent even if not exercised at M1 — it can reach for them when it judges relevant
- `server/src/index.ts` and the CLAUDE.md "Stack" line change at M1
- Migration is one-way for the foreseeable future; reverting would mean rebuilding the loop manually

### 2026-04-28 · Project scaffolding & docs

Set up `.claude/settings.json` (permission allowlist), `docs/design.md` (this file), `docs/milestones.md`, and a `/check` slash command for typechecking. Subagents, skills, and additional slash commands deferred until repeated patterns emerge.

### 2026-04-27 · Anthropic SDK for M0 (not Agent SDK)

M0 is chat-only — no tools, no agent loop. The Claude Agent SDK adds machinery (built-in tools, MCP, hooks) we don't need yet. Revisit at M1: stay on `@anthropic-ai/sdk` with its tool runner, or migrate to the Agent SDK if we want richer Claude-Code-style semantics.

### 2026-04-27 · Light wrapper, custom UI (architectural pivot)

Original plan: thin wrapper around the Claude Code CLI via MCP server + hooks. Pivoted because Claude Code owns its terminal UI and the user wanted full UI control. Trade-off: we own the agent loop and UI; we lose Claude Code's terminal UX (slash commands, sessions). Acceptable.

### 2026-04-27 · TypeScript everywhere

Original proposal: Python for the MCP server. User rejected. One language across frontend, backend, and any future tooling.

### 2026-04-27 · SQLite KG (M1 scope, decision locked)

File-based, queryable, FTS built in, no server. Day-one entity types — `Person, Place, Device, Project, Task, Event, Preference, Document, Topic, Organization`. Day-one edge types — `KNOWS, LIVES_WITH, WORKS_AT, OWNS, LOCATED_IN, PART_OF, RELATES_TO, SCHEDULED_FOR, ASSIGNED_TO, PREFERS, DEPENDS_ON, MENTIONED_IN`. Schema is *soft*: a `props_json` bag absorbs anything not covered.

### 2026-04-27 · Aesthetic — dark monochrome

Pure black (`#0a0a0a`), zinc grayscale, Geist Sans + Geist Mono. User messages: subtle bubble. Assistant messages: bubble-less, journalistic. Pulsing cursor while streaming, fade-in on new messages, custom scrollbar. No accent color, no gradients. Negative space over decoration.

## Deferred

Real choices we'll make later — listed here so they don't get lost.

- **KG identity resolution** — exact-name match for v1; merge logic ("Alice" vs "Alice Chen") later
- **Context-injection token cap** — start with 20-node / ~2K-token cap; tune from real usage (M2)
- **Conversation persistence** — refresh wipes history in M0; add when M1 lands
- **Embeddings provider** — Voyage AI / OpenAI / local sentence-transformers (decide at M3)
- **Backup, encryption-at-rest** — local-only plaintext for now; revisit if syncing to cloud
- **Subagents, additional slash commands, skills, hooks** — add when patterns prove themselves, not preemptively
