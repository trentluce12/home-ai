# home-ai — design

A personal AI: streaming chat UI on top of the Anthropic API. Knowledge graph context lands in M1.

## Architecture

- **`web/`** — Vite + React + TS + Tailwind. Single chat surface. POSTs to `/chat`, consumes SSE.
- **`server/`** — Hono + `@anthropic-ai/sdk`. `/chat` opens an SSE stream, calls `messages.stream()`, forwards text deltas to the browser.
- **Workspace** — npm workspaces; `concurrently` runs both dev servers under `npm run dev`. `dotenv` loads `.env` from project root via an explicit relative path (workspaces cd into the workspace dir, so cwd-based loading would miss it).

## Decisions

Newest first. Append entries; don't edit history.

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
