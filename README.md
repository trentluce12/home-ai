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

## Deploy

Self-hosted Docker on a single host. The image is multi-stage (build → runtime), runs as the non-root `node` user with a read-only root FS, and writes only to `/data` (the named volume holding `kg.sqlite` + WAL/SHM sidecars).

### 1. Set env vars

Create `.env` next to `docker-compose.yml`. Required:

- `HOME_AI_PASSWORD_HASH` — bcrypt hash of your login password. Generate it from the `server/` workspace (`bcrypt` is a server dep):
  ```sh
  cd server && node -e "console.log(require('bcrypt').hashSync(process.argv[1], 12))" 'mypassword'
  ```
  Copy the resulting `$2b$12$...` string into `.env`. Don't quote it — `.env` parses it raw.
- `ANTHROPIC_API_KEY` — your Anthropic key (claude-opus-4-7).
- `VOYAGE_API_KEY` — your Voyage key (used for `voyage-3-large` embeddings; retrieval falls back to FTS-only if unset, but you'll lose semantic recall).

Optional:

- `HOME_AI_ALLOW_WRITE_TOOLS=true` — re-enable `Bash`, `Write`, `Edit` for the agent. Off by default in production: an auth bypass shouldn't grant arbitrary shell.
- `SESSION_ARCHIVE_DAYS` (default `30`) — sessions idle longer than this are hidden from the sidebar. Set `0` to disable.
- `SESSION_DELETE_DAYS` (default `180`) — sessions idle longer than this are deleted. Set `0` to disable.
- `PORT` (default `8080` in the container) — change if `8080` is taken on the host; also update the `ports:` mapping in `docker-compose.yml`.

### 2. Bring it up

```sh
docker compose up -d --build
```

Then hit <http://localhost:8080>, log in with the password you hashed above, and start chatting. The healthcheck pings `GET /`; `docker compose ps` will show `healthy` once it's serving.

### 3. Back up `/data`

The KG and all session history live in `/data/kg.sqlite` (plus `-wal` and `-shm` sidecars while the server runs). WAL mode is on, so the canonical online-safe snapshot is:

```sh
docker compose exec home-ai \
  sh -c 'sqlite3 /data/kg.sqlite ".backup /data/backup.sqlite"'
docker cp home-ai:/data/backup.sqlite ./backup-$(date +%F).sqlite
```

Alternatively, copy all three files together (`kg.sqlite`, `kg.sqlite-wal`, `kg.sqlite-shm`) — the WAL pragmas this project sets make a same-instant 3-file snapshot consistent. Don't copy `kg.sqlite` alone while the server is running; you'll miss anything still in the WAL.

To restore, drop the backup file (or all three sidecars) back into the `home-ai-data` volume and restart the container.

## Roadmap

- **M0** (current) — chat UI + Anthropic SDK backend, no KG, no tools
- **M1** — SQLite KG (`better-sqlite3`); register KG tools with the SDK; agent self-learns. Sidebar shows what was remembered.
- **M2** — passive subgraph injection on every turn (FTS + 1-hop)
- **M3** — embeddings, hybrid retrieval, provenance + confidence
- **M4** — graph viz panel, slash commands, export, backups

## License

[MIT](./LICENSE) — clone, fork, modify, use however you like; just keep the copyright notice.

This is a personal project. External contributions (PRs, issues) won't be reviewed — if you want to take it in your own direction, fork it.
