# README deploy section

**Why:** Make deployment reproducible without forcing a re-read of `docs/design.md`. Last task before M4.5 ships.

**What:** Add a "Deploy" section to README covering:
- Required env: `HOME_AI_PASSWORD_HASH` (bcrypt), `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`. Optional: `HOME_AI_ALLOW_WRITE_TOOLS=true`, `SESSION_ARCHIVE_DAYS`, `SESSION_DELETE_DAYS`, `PORT`.
- bcrypt hash recipe (one-liner, e.g. `node -e "console.log(require('bcrypt').hashSync(process.argv[1], 12))" 'mypassword'`).
- `/data` volume mount + backup recipe: snapshot `kg.sqlite`, `kg.sqlite-wal`, `kg.sqlite-shm` together (WAL settings already make this safe).
- `docker compose up` quickstart.

**Files:** `README.md`

**Estimate:** TBD
