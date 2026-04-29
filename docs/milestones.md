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

## M3 — embeddings + hybrid retrieval

- [ ] Add `node_embeddings` table (BLOB column for vectors)
- [ ] Compute embeddings on node create/update (provider TBD: Voyage / OpenAI / local sentence-transformers)
- [ ] Hybrid retrieval: FTS + cosine similarity + graph expansion
- [ ] Provenance + confidence on facts (lower for agent-extracted, higher for user-stated)
- [ ] Cache the system + tools prefix; subgraph context goes after the breakpoint

## M4 — quality of life

- [ ] Graph visualization panel (`react-force-graph` or `sigma.js`)
- [ ] In-chat slash commands (`/recent`, `/forget`, `/stats`)
- [ ] Backups / export (JSON, graphviz)
- [ ] Bulk import (Obsidian markdown, JSON)
- [ ] Conversation persistence (per-session; resume on refresh)
