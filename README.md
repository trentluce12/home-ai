# home-ai

A personal home AI. Chat UI + streaming Anthropic backend. Knowledge graph context layered on later (M1+).

## Setup

```sh
# 1. Install dependencies
npm install

# 2. Add your Anthropic API key
cp .env.example .env
# edit .env and paste your key

# 3. Run it
npm run dev
```

The web UI lives at <http://localhost:5173>. The backend lives at <http://localhost:3001>.

## Layout

```
home-ai/
├── server/         # Hono + @anthropic-ai/sdk, SSE chat endpoint
├── web/            # Vite + React + Tailwind + shadcn/ui, chat UI
├── package.json    # workspace root (npm workspaces + concurrently)
└── .env            # ANTHROPIC_API_KEY
```

## Roadmap

- **M0** (current) — chat UI + Anthropic SDK backend, no KG, no tools
- **M1** — SQLite KG (`better-sqlite3`); register KG tools with the SDK; agent self-learns. Sidebar shows what was remembered.
- **M2** — passive subgraph injection on every turn (FTS + 1-hop)
- **M3** — embeddings, hybrid retrieval, provenance + confidence
- **M4** — graph viz panel, slash commands, export, backups
