# home-ai — design

A personal AI: streaming chat UI on top of the Anthropic API. Knowledge graph context lands in M1.

## Architecture

- **`web/`** — Vite + React + TS + Tailwind. Single chat surface. POSTs to `/chat`, consumes SSE.
- **`server/`** — Hono + `@anthropic-ai/sdk`. `/chat` opens an SSE stream, calls `messages.stream()`, forwards text deltas to the browser.
- **Workspace** — npm workspaces; `concurrently` runs both dev servers under `npm run dev`. `dotenv` loads `.env` from project root via an explicit relative path (workspaces cd into the workspace dir, so cwd-based loading would miss it).

## Decisions

Newest first. Append entries; don't edit history.

### 2026-05-02 · ESLint + Prettier across both workspaces

`chore-lint-format` set up the gates the updated story-implementer contract will key off (`npm run lint`, `npm run format:check`). Stack: ESLint 9 flat config (`eslint.config.mjs` at the repo root), `@eslint/js` + `typescript-eslint` recommended, plus `eslint-plugin-react` + `eslint-plugin-react-hooks` scoped to `web/**`. Prettier 3 with a config that matches the existing house style (2 sp, double quotes, `printWidth: 90`, `endOfLine: "lf"`). `eslint-config-prettier` last in the rule chain so the two tools don't fight over layout. Per-workspace `lint`/`lint:fix`/`format`/`format:check` scripts mirror the root ones — both spellings work.

Two judgement calls worth pinning:

**Markdown excluded from Prettier (`.prettierignore`).** A first run showed Prettier wanted to rewrite `*emphasis*` → `_emphasis_` and add blank lines after section headers across every `docs/`, `tasks/`, and `.claude/commands/` markdown file. That's high-churn, low-value reformatting of carefully hand-authored prose. Markdown is in `.prettierignore` project-wide; if a future task wants prose-rule enforcement, it should pick a markdown-aware linter (e.g., `markdownlint`) rather than Prettier's blunt reformat.

**`react/no-unescaped-entities` disabled.** The rule fires on bare `'` and `"` inside JSX text (e.g., `<p>what's on your mind?</p>`). React renders these fine; escaping them as HTML entities makes the source string less readable. Off project-wide. Other react-recommended rules stay on.

**Flat config in `.mjs`, not `.js`.** Avoids forcing `"type": "module"` on the root `package.json` (which would change how Node resolves every `.js` we add at the root later — currently we have `web/postcss.config.js` in the existing CommonJS-by-default world). The `.mjs` extension is unambiguous to Node.

Existing source got reformatted in one sweep so the gates start green. The diff is mechanical (line-wrapping, trailing comma, etc.) — no semantic changes. `server/src/index.ts` was among the touched files, which overlaps with the still-parked `m45-api-prefix` task that needs to edit it; flagged for the main thread.

### 2026-05-02 · `.claude/` workflow hardening — 6-area design

Started this session intending to nail down a structured way of working on home-ai. Too much had been emerging ad-hoc: the task lifecycle was half-defined, `/task-start` did less than its name implied, the ralph-loop pitch existed but had no infrastructure, and rules like "never commit on main" were user-vigilance rather than enforced. Designed across six areas and queued the build-out as 18 task files in `tasks/planned/`.

**Foundation: tool taxonomy.** Before adding anything to `.claude/`, locked in what each tool *is for* — to prevent overlap (e.g., "is this a command or a subagent?"):

- **Slash command** — explicit user verb; templated workflow; `/x` invocation
- **Subagent** — encapsulated specialist work that benefits from isolation (fresh context, focused prompt)
- **Skill** — context-dependent expertise auto-loaded when triggers match
- **Main thread** — synthesis, decisions, anything needing full conversation context
- **Hook** — event-driven enforcement, runs outside Claude's reasoning

**Area 1 — agents / commands / lifecycle.** The `story-implementer` subagent gets a real contract: pre-flight overlap check (defensive, area 5), `npm run typecheck` + `lint` + `format:check` + grep-for-new-TODO/console.log/debugger gates with a 3-attempt retry cap, Status/Started/Notes management on the task file, fail-loud principle (don't silently work around). Three new subagents to build: `story-planner` (file-disjoint batch picker, sonnet, read-only), `bug-hunter` (root-cause analysis, opus, doesn't fix unless told), `refactorer` (mechanical multi-file changes, opus, behavior-preservation guarantee). Seven new slash commands to round out the workflow: `/task-batch`, `/task-status`, `/task-revert`, `/bug`, `/refactor`, `/design-log`, `/seed-fact`. New task-file format adds `Status` / `Started` / `Notes` / `Dependencies` / `Smoke steps` fields; `---` separates user-authored from agent-managed sections. Naming convention formalized: `m<N>[p<K>]-`, `bug-`, `refactor-`, `chore-`, `spike-`. Dependency-aware `/task-start` refuses to claim a task whose deps are still pending.

**Area 2 — coding rules → skills.** Original lean was `docs/conventions/*.md` (always-loaded docs); switched to `.claude/skills/` so they auto-load only when triggers match — smaller per-session context, cleaner separation from architecture docs. Six project-scoped skills: `typescript`, `hono`, `react`, `tailwind`, `anthropic-sdk` (project layer on top of the global `claude-api` skill), `sqlite`. Triggers are file paths or imports — e.g., `sqlite` loads when editing files that import `better-sqlite3`. Git rules get a dedicated CLAUDE.md section + a hook (area 4) for the never-main rule. MCPs stay none for now — the in-process KG tools work fine; an MCP layer would be complexity for no benefit.

**Area 3 — improvement lifecycle.** Formalized when to add (3-retype rule / 3-step workflow / single recurring error class), when to revise (2+ contract violations in real use — single failures are noise), and when to deprecate (per-milestone audit; 60+ days untouched + no codebase refs → candidate for removal, never auto-deleted). Versioning is rolling-edit; git history is the version log. Design log entries required for non-trivial `.claude/` changes — this entry qualifies. Audit cadence is per-milestone (not time-based — milestone closure is the natural reflection point) via a new `/audit-claude-folder` command that produces a fresh `chore-audit-claude-folder-<date>.md` task with findings (queue-tracked, not ephemeral). Cross-pollination with `~/.claude/`: stay project-only by default; promote globally only if a 2nd project would actually use the thing.

**Area 4 — settings + hooks.** Hook scripts live in `.claude/scripts/` as Node `.mjs` files — truly cross-platform (works on Windows + Mac + Linux without bash-vs-PowerShell drama). Two initial hooks: `SessionStart` for stale-task detection (warns about `/in-progress/` files older than 1h — likely orphans from crashed agents); `PreToolUse` on `Bash` to block `git commit` when HEAD = main. Failure semantics: `PreToolUse` non-zero exit **blocks** the tool call (intentional — that's how the blocker works); `SessionStart` non-zero **logs to stderr but doesn't crash** the session (a missing warning isn't worth bricking the session). `settings.json` committed (project-wide policy + hook configs); `settings.local.json` gitignored (per-user permission allowlists). M4.5 production tool-narrowing happens at the Agent SDK layer in `server/src/index.ts`, not in the harness — different concerns, kept separate.

**Area 5 — multi-agent coordination.** Worktrees + file-disjoint planning, both. Worktrees (harness-provided via `isolation: "worktree"`) give true experimental isolation; file-disjoint planning by `story-planner` makes the diff-back-to-`dev-tl` step mechanical (no merge conflicts). Cap at 5 parallel agents — arbitrary but reasonable for personal-project scale and Claude API budget. Failure containment: one agent failing doesn't abort the batch; others continue, failed task lands in `/in-progress` with `Status: blocked` for human triage. Defense-in-depth: `story-implementer` cross-checks `tasks/in-progress/` for `**Files:**` overlap before starting (catches manual `/task-start` during a ralph batch). Commit-as-each-finishes by default; can defer to batch-review later if it gets noisy. Lock model: the file move (`/planned` → `/in-progress`) is the lock; nothing else picks up a claimed task.

**Area 6 — communication conventions.** Codified what was emerging organically: brief by default for conversational, structured-but-as-long-as-needed for design discussions, tight bullets for status reports (what changed / verified / next; never narrate tool calls). Ask vs decide gates on reversibility + state-impact + scope ambiguity. Single targeted clarifying question when unclear — never a wall of questions. Push back with reason when the user is wrong about something concrete (factual, not preference) — don't capitulate to be agreeable. Defer when it's preference vs preference. File refs always use `path/file.ts:42` format (clickable in the harness). Honest about uncertainty (state assumptions, don't fake confidence). No emojis unless asked.

**Outputs.**

- 18 new task files in `tasks/planned/` (10 area 1 + 7 area 2 + 1 area 3); areas 4–6 produced edits, not new tasks
- One umbrella task (`chore-update-claude-md`) consolidates all 6 areas' policy into the project's entry-point doc — depends on basically everything else, ships last
- Two previously-blocked tasks (`chore-stale-task-detection`, `chore-prevent-main-commits`) unblocked by the area-4 hook design
- Removed `Skills (.claude/skills/)` and `Hooks` from CLAUDE.md's "don't add until needed" list — past those gates now

**What's not in scope (intentionally).**

- Auto-delete of stale entries (audit surfaces; human decides)
- Time-based audit cadence (per-milestone instead — natural reflection point)
- Metrics / observability (defer until there's a reason to optimize)
- Promoting project skills to global `~/.claude/` until a 2nd project would actually use them
- Sub-subagent hierarchies (story-implementer doesn't spawn its own helpers — keeps the model simple)

**Suggested implementation order.** `chore-lint-format` first (foundation for the gates). Then ralph the 6 skill tasks + 3 subagent tasks once `story-planner` ships and `/task-batch` is wired up. Save `chore-update-claude-md` for last — it's the consolidator.

### 2026-05-01 · M4.5 — production deployment + auth (design, not yet built)

home-ai is moving from "localhost on my dev machine" to "Docker container + persistent volume on a machine I host, reachable from anywhere." Two things that the localhost setup hides become blocking-before-ship: there is no auth, and the agent's tool surface (Bash + Write + Edit + Read + Glob + Grep + WebFetch + WebSearch) is effectively remote code execution on a public URL. M4.5 closes that gap before M5 (notes layer) so we never accumulate sensitive data on an unauthed deployment.

**Why before M5.** Auth retrofitted onto a public URL with real data is strictly worse than auth designed in before deploy. M5 will roughly double the volume of personal context home-ai stores (notes are richer than facts). Doing M4.5 first means M5 ships against a hardened deployable.

**Auth — password + DB-backed session cookies.** Single-user, single password. Decisions:
- Server reads `HOME_AI_PASSWORD_HASH` (bcrypt) from env at boot. No user table — the env hash *is* the credential set.
- New table `auth_sessions(token TEXT PK, created_at, expires_at, last_seen_at)`. `token` is a 32-byte URL-safe random.
- New routes: `POST /api/auth/login` (body: `{password}`) → set HttpOnly Secure SameSite=Lax cookie `home_ai_session=<token>`, return `{ok}`. `POST /api/auth/logout` → revoke. `GET /api/auth/me` → `{authenticated: bool}` for the SPA to gate render.
- Middleware on all `/api/*` except auth routes: read cookie, lookup token, reject with 401 if missing/expired. Sliding expiry — bump `last_seen_at` on any authed request, expire after 30 days idle.
- Brute-force defense: per-IP rate limit on `/api/auth/login` (5 attempts / 15 min) via a tiny in-memory bucket. No need for Redis at single-user scale.
- HttpOnly cookies (not localStorage) so XSS can't exfil the session. Cookie set via Hono's `setCookie` helper.

Considered and rejected: shared-secret-in-header (vulnerable to XSS), magic-link (needs email infra for one user), OIDC (overkill), JWTs (signing keys are operational complexity for nothing — DB lookup is fast enough).

Considered and explicitly *out of scope but compatible*: putting Cloudflare Tunnel + Cloudflare Access in front and skipping in-app auth entirely. The above design doesn't preclude that — Cloudflare Access can sit upstream of an authed backend without conflict.

**Tool narrowing.** Default `allowedTools` in prod drops `Bash`, `Write`, `Edit`. Keeps `Read`, `Glob`, `Grep`, `WebFetch`, `WebSearch`, plus all `mcp__kg__*`. Rationale: chat usage of home-ai doesn't actually exercise Bash/Write/Edit day-to-day; they're leftover from local-dev habits. Removing them shrinks the blast radius of an auth bypass to "read files in the container + browse the web" — much smaller than "execute arbitrary shell." Opt-in via `HOME_AI_ALLOW_WRITE_TOOLS=true` env var if a use case appears.

**Container shape.** Multi-stage Dockerfile:
- Builder stage: `node:22-alpine`, `npm ci` at workspace root, `npm run build` (server tsc + `vite build`).
- Runtime stage: `node:22-alpine`, copy `server/dist`, `web/dist`, `node_modules` (prod-only), and `package.json`s. Entrypoint: `node server/dist/index.js`.
- Non-root user (`uid 1000`). Read-only root FS. `/data` is the only writable mount, holds `kg.sqlite` (and its WAL + SHM sidecars).
- Single exposed port from `PORT` env (default `8080` in prod, keeps `3001` in dev so nothing existing breaks).
- No host docker socket mounted, no host network. Healthcheck: `GET /` → 200.

**Single-origin frontend.** Hono will serve the built web bundle at `/` (and assets) so frontend + API share an origin. To make the route surface unambiguous, all existing API endpoints move under `/api/*`:
- `/chat` → `/api/chat`
- `/sessions[/...]` → `/api/sessions[/...]`
- `/kg/*` → `/api/kg/*`

Web client change: `SERVER_URL` constant in `web/src/lib/api.ts` becomes `import.meta.env.VITE_SERVER_URL ?? ""` — empty string for prod (relative paths), kept as `http://localhost:3001` in `.env.development`. CORS config drops the hardcoded origin and is removed entirely in prod (single origin, no preflight).

**Prod boot.** `npm --workspace server run start` runs `node dist/index.js`. The Dockerfile entrypoint calls node directly so npm script overhead is gone. The dev-only `predev` seed-wipe is already correctly scoped to dev — `start` doesn't touch it. On first boot, `kg/db.ts` already runs `mkdirSync(DATA_DIR, { recursive: true })` and applies schema idempotently; `auth_sessions` joins the same `db.exec(SCHEMA_SQL)` block.

**Backups.** Daily snapshot of the `/data` volume, scheduled via host cron or the user's Docker-host backup tool of choice. SQLite WAL + busy-timeout settings already make this snapshot-safe; backing up `kg.sqlite + kg.sqlite-wal + kg.sqlite-shm` together is sufficient.

**Out of scope (intentionally).**
- Multi-user accounts. Single-user is the deployment model.
- TOTP / 2FA. Out of scope for a single-user app behind a strong password; revisit if threat model changes.
- Audit logging. Stdout logs go to Docker's log driver; that's enough at single-user scale.
- Reverse proxy choice. Caddy / Cloudflare Tunnel / nginx are all fine — out-of-band from this app.
- Auto-update / migrations beyond the idempotent `db.exec(SCHEMA_SQL)` already in place.

**Story breakdown for implementation.**
1. `auth_sessions` table + session lifecycle helpers (server/src/auth/store.ts).
2. `POST /api/auth/login` / `logout` / `me` routes + bcrypt verify + rate limit.
3. Auth middleware + apply to all non-auth `/api/*` routes.
4. Move all routes under `/api/` prefix. Update `web/src/lib/api.ts`.
5. Login page in the web app + auth-state gate before app render.
6. Hono static-file serving for `web/dist` (catch-all that doesn't shadow `/api/*`).
7. Tool narrowing: env-driven `allowedTools` filter.
8. Multi-stage Dockerfile + `.dockerignore` + a `docker-compose.yml` for local prod-shape testing.
9. README updates: deploy instructions (env vars, volume mount, backup).

Smoke test for ship: `docker compose up` on a clean machine, set env, hit the URL, log in, send a chat, see KG facts persist across container rebuild.

### 2026-04-29 · backlog batch — 14 stories from `docs/backlog.md`

All 14 backlog items shipped together on `dev-tl`. Notes on the non-trivial ones:

**#10 Ground capabilities (system prompt).** Added an explicit "YOUR ACTUAL CAPABILITIES" section to `SYSTEM_PROMPT` listing what the model can/cannot do. The trigger was a chat where the model invented Gmail/Calendar integrations — listing the literal tool surface stops it from confabulating features that don't exist.

**#11 Re-embed on rename.** `update_node` now snapshots `before` via `kg.getNode(id)` before mutating, then calls `embedNode(node)` if the name changed. Failures warn-and-continue (same pattern as `recordFact`). Closes the deferred-item flagged in M3.

**#13 Smart titles.** After a successful `result` event, fire-and-forget `maybeSmartTitle(sessionId)`. Counts user turns from `getSessionMessages`; if ≥ 2 and no `customTitle`, sends a 32-token Haiku call (`claude-haiku-4-5-20251001`) summarizing the first 6 turns to a 4–6 word title, then `renameSession()`. An in-process `titledSessions: Set<string>` prevents double-firing on concurrent or repeat turns. Used a raw `fetch` against `/v1/messages` rather than pulling in `@anthropic-ai/sdk` — keeps deps unchanged and the Voyage embedding code already establishes the pattern.

**#9 Saved graph layout.** New `node_layout(node_id PK FK ON DELETE CASCADE, x REAL, y REAL, updated_at)` — cascade was important so forgetting a node doesn't leave orphan rows. Two endpoints (`GET /kg/layout`, `POST /kg/layout`). On graph open, hydrate saved positions into `graphology` node attributes before rendering. New nodes (no saved layout) get seeded near the centroid of placed nodes so FA2 has somewhere to start. When a saved layout exists, FA2 runs with weak settings (`scalingRatio: 1, gravity: 0.1, slowDown: 20`) so it nudges new nodes into place without reflowing the whole graph; fresh layouts still get the original strong run. After the 4s settle, snapshot every node's `(x,y)` and POST.

**#7 + #14 Token/cost.** Server-side, the `done` SSE event already included `usage` and `total_cost_usd`. Added a new `MemoryEvent` variant `DoneEvent`, render a quiet per-turn footnote in the sidebar, and a session-total footer (`$0.012 · 4.2k tokens · 87% cached`) at the bottom of the panel.

**#3 Smart auto-scroll.** Track scroll-near-bottom on the `<main>` scroll container. `stickToBottomRef` is a ref (not state) because the scroll listener fires too often to round-trip through React. The "↓ jump to latest" button is a `position: sticky` element inside the scroll container, which keeps it visible even as `<main>` scrolls.

**#1 Stop streaming.** `AbortController` per request stored in `abortRef`. On abort, `fetch` rejects — caught and ignored when `controller.signal.aborted` so no error banner pops up. Server side already terminates SSE cleanly on consumer disconnect, so no server changes needed.

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
