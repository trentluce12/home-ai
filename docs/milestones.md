# home-ai — milestones

## M0 — chat (current, shipped)

- [x] Vite + React + TS + Tailwind frontend
- [x] Hono + Anthropic SDK backend with SSE streaming
- [x] npm workspaces; `npm run dev` boots both
- [x] Dark monochrome aesthetic, Geist fonts, pulsing cursor
- [x] Conversation history sent on each turn (stateless backend)
- [x] Project scaffolding: `.claude/settings.json`, `/check`, `docs/`

Verified: chat works end-to-end with streaming.

## M1 — knowledge graph + self-learning tools

- [ ] SQLite database in `data/kg.sqlite` via `better-sqlite3`
- [ ] Schema: `nodes`, `edges`, `nodes_fts`, `provenance`
- [ ] KG tools registered with the SDK: `kg_search`, `kg_get`, `kg_neighbors`, `kg_add_node`, `kg_add_edge`, `kg_link`, `kg_update_node`, `kg_recent`, `kg_stats`
- [ ] Tool runner loop on the backend
- [ ] System prompt updated to instruct self-learning (record new facts via tools)
- [ ] UI sidebar showing "what I remembered this turn"
- [ ] Smoke test: "I have a dog named Lily" → KG inspection shows Person, Pet, OWNS edge

**SDK** (locked 2026-04-28): Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`). The M1 backend uses `query()` to drive the agent loop, with KG tools registered alongside the SDK's built-ins. See `docs/design.md` for rationale.

## M2 — passive subgraph injection

- [ ] On each turn: FTS search over the user's prompt → expand 1 hop → format as compact context block
- [ ] Inject as additional system message (or pre-pended user message)
- [ ] Cap subgraph size (start at 20 nodes / ~2K tokens; tune)
- [ ] UI: sidebar shows what was injected this turn (transparent retrieval)
- [ ] Test: after recording "my dog is Lily" once, "what's my dog's name?" answers without a tool call

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
