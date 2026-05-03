---
name: sqlite
description: TRIGGER when editing files that import `better-sqlite3` OR any file under `server/src/kg/**/*.ts` (e.g., `db.ts`, `retrieve.ts`, `tools.ts`). Project-specific patterns for the home-ai SQLite knowledge graph — synchronous API, transactions, prepared statements, FK cascades, WAL mode, FTS5 sync.
---

# sqlite — home-ai KG patterns

The home-ai knowledge graph lives in a single SQLite database (`data/kg.sqlite`) accessed via `better-sqlite3`. The schema is defined in `SCHEMA_SQL` in `server/src/kg/db.ts` and applied idempotently at module load. Follow these rules when editing KG code.

## Rules

- **Synchronous API.** `better-sqlite3` is fully synchronous — no `async`/`await`, no Promises around DB calls. Wrapping a `db.prepare(...).run(...)` in `await` is a smell and will mislead readers.

- **Transactions for multi-statement work.** Anything that writes more than one row, or reads-then-writes, goes inside `db.transaction(() => { ... })()`. Atomicity matters (e.g., `deleteNode` cascades into `provenance` cleanup before deleting the node itself). Pattern:

  ```ts
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM provenance WHERE ...`).run(...);
    db.prepare(`DELETE FROM nodes WHERE id = ?`).run(id);
  });
  tx();
  ```

- **Prepared statements.** Use `db.prepare(...)` for every query. For hot paths (called per-row in a loop, e.g., `neighbors` resolving each connected node), cache the prepared statement at module scope or just outside the loop — don't re-prepare per call. SQLite caches them internally to a degree, but explicit caching is cheaper and clearer.

- **WAL mode is on.** `db.pragma("journal_mode = WAL")` runs at init in `db.ts`. Leave it. WAL gives concurrent reader/writer behavior and makes snapshot-style backups safe (back up `kg.sqlite` + `kg.sqlite-wal` + `kg.sqlite-shm` together).

- **FK cascades for cleanup.** Foreign keys are enabled (`db.pragma("foreign_keys = ON")`). Tables tied to a node lifecycle declare `REFERENCES nodes(id) ON DELETE CASCADE`:
  - `node_layout` — graph positions
  - `node_embeddings` — Voyage vectors
  - `edges` — both `from_id` and `to_id`
  - `provenance` is *not* FK-cascaded (no FK; it's keyed by `(fact_id, fact_kind)` and cleaned up explicitly in `deleteNode`'s transaction). New tables tied to a node should follow the cascade pattern unless there's a reason not to.

- **FTS5 + `nodes_fts` shadow table.** The virtual `nodes_fts` table is kept in sync via `nodes_after_insert` / `nodes_after_delete` / `nodes_after_update` triggers — already wired in `SCHEMA_SQL`. Don't write to `nodes_fts` directly. If you change the columns indexed by FTS, update the triggers in lockstep.

- **Schema is idempotent.** `db.exec(SCHEMA_SQL)` runs on every boot. Every `CREATE TABLE` / `CREATE INDEX` / `CREATE TRIGGER` uses `IF NOT EXISTS`. Adding a new table or index? Append it to `SCHEMA_SQL` with `IF NOT EXISTS`. **Don't** write one-off migration scripts for additive schema changes — let the boot path handle it. Destructive migrations (renaming columns, dropping tables) need explicit handling and a design log entry.

## Cross-references

- **Hybrid retrieval (FTS + cosine + RRF).** See the M3 design log entry (`docs/design.md`, 2026-04-28 · M3) for how `retrieve.ts` combines `nodes_fts` MATCH queries with brute-force cosine over `node_embeddings` via Reciprocal Rank Fusion (k=60). In-memory cosine is fine until the KG passes ~10K nodes; swap to `sqlite-vec` when that becomes a real concern.

- **Sessions in SQLite.** `sessions` and `session_entries` are SDK-adapter-owned (see M4 phase 1.5 design log entry). The `session_entries.payload_json` column is opaque pass-through — don't introspect or normalize it.
