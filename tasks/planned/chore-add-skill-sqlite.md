# Add sqlite project skill

**Why:** Area 2 — `better-sqlite3` patterns (transactions, prepared statements, FK cascades, WAL mode) should auto-load when editing KG code.

**What:** Create `.claude/skills/sqlite/SKILL.md` with:

- **Name:** `sqlite`
- **Description (with TRIGGER):** Triggers when editing files that import `better-sqlite3` OR files under `server/src/kg/**/*.ts`.
- **Body — rules:**
  - Use `better-sqlite3`'s synchronous API (no async/await)
  - All multi-statement work in transactions: `db.transaction(() => { ... })()`
  - Prepared statements (`db.prepare(...)`) — cache them at module scope, don't build per-call
  - WAL mode is on (set in `db.ts` init); leave it
  - Use FK cascades for cleanup (e.g., `node_layout`, `node_embeddings`, `provenance` all cascade on node delete)
  - FTS5 + `nodes_fts` shadow table — keep in sync via triggers (already set up)
  - Cross-reference: M3 design log entry (2026-04-XX) for hybrid retrieval (FTS + cosine + RRF) details
  - Schema lives in `SCHEMA_SQL` constant in `db.ts`; `db.exec(SCHEMA_SQL)` is idempotent — safe to call on every boot

**Files:** `.claude/skills/sqlite/SKILL.md` (new)

**Estimate:** 30 min

**Dependencies:** none

**Smoke steps:** Edit `server/src/kg/db.ts`; verify skill loads.

---

**Status:** pending
**Started:** —

## Notes
