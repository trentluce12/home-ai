# JSON KG import

**Why:** Round-trips the JSON export — useful for backup restore and migration between machines.

**What:** Endpoint that accepts the export shape (full snapshot minus embeddings), inserts nodes/edges with provenance source `bulk_import`, and re-embeds inserted nodes. Decide on merge strategy (default: skip nodes whose name+type already exist; flag for replace-all). Likely a dashboard upload button. Wrap the insert in a transaction so a partial failure doesn't leave the KG half-imported.

**Files:** `server/src/index.ts`, `server/src/kg/db.ts`, `web/src/components/EmptyDashboard.tsx`, `web/src/lib/api.ts`

**Estimate:** TBD
