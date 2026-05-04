import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { customAlphabet } from "nanoid";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "../../../data");
const DB_PATH = resolve(DATA_DIR, "kg.sqlite");

mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  props_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);
CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name);

CREATE TABLE IF NOT EXISTS edges (
  id TEXT PRIMARY KEY,
  from_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  to_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  props_json TEXT NOT NULL DEFAULT '{}',
  confidence REAL NOT NULL DEFAULT 1.0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_id);
CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_id);
CREATE INDEX IF NOT EXISTS idx_edges_type ON edges(type);

CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
  id UNINDEXED,
  name,
  props_json
);

CREATE TRIGGER IF NOT EXISTS nodes_after_insert AFTER INSERT ON nodes BEGIN
  INSERT INTO nodes_fts(id, name, props_json) VALUES (new.id, new.name, new.props_json);
END;

CREATE TRIGGER IF NOT EXISTS nodes_after_delete AFTER DELETE ON nodes BEGIN
  DELETE FROM nodes_fts WHERE id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS nodes_after_update AFTER UPDATE ON nodes BEGIN
  DELETE FROM nodes_fts WHERE id = old.id;
  INSERT INTO nodes_fts(id, name, props_json) VALUES (new.id, new.name, new.props_json);
END;

CREATE TABLE IF NOT EXISTS provenance (
  fact_id TEXT NOT NULL,
  fact_kind TEXT NOT NULL CHECK(fact_kind IN ('node', 'edge')),
  source TEXT NOT NULL,
  source_ref TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_provenance_fact_id ON provenance(fact_id);

CREATE TABLE IF NOT EXISTS node_embeddings (
  node_id TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  vector BLOB NOT NULL,
  dim INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  project_key TEXT NOT NULL,
  session_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_active INTEGER NOT NULL,
  archived_at INTEGER,
  -- Sidecar JSON owned by the SDK's foldSessionSummary helper. Opaque to us.
  summary_json TEXT,
  PRIMARY KEY (project_key, session_id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_last_active ON sessions(last_active DESC);

CREATE TABLE IF NOT EXISTS session_entries (
  -- ROWID provides chronological ordering within a session.
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_key TEXT NOT NULL,
  session_id TEXT NOT NULL,
  subpath TEXT NOT NULL DEFAULT '',
  uuid TEXT,
  type TEXT NOT NULL,
  timestamp TEXT,
  payload_json TEXT NOT NULL,
  FOREIGN KEY (project_key, session_id)
    REFERENCES sessions(project_key, session_id) ON DELETE CASCADE
);

-- Idempotency: SDK may replay entries with the same uuid; reject duplicates.
-- Partial index — entries without uuids (titles, tags, mode markers) bypass dedup.
CREATE UNIQUE INDEX IF NOT EXISTS idx_session_entries_uuid
  ON session_entries(uuid) WHERE uuid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_session_entries_session
  ON session_entries(project_key, session_id, subpath);

CREATE TABLE IF NOT EXISTS node_layout (
  node_id TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
  x REAL NOT NULL,
  y REAL NOT NULL,
  updated_at INTEGER NOT NULL
);

-- M5 phase 1: free-form markdown body attached 1:1 to a node. Cascades on
-- forget so notes never orphan. updated_at is an ISO-8601 string (per the
-- M5 design); the rest of the schema uses INTEGER ms-since-epoch -- one-off
-- inconsistency intentional to match the M5 spec.
--
-- M6 phase 2: 'name' column gives the note its own renamable display label,
-- decoupled from the underlying node's name. On migration of a pre-M6 DB the
-- column is added nullable + backfilled from nodes.name (see the ALTER TABLE
-- block below SCHEMA_SQL). Fresh DBs declare it NOT NULL.
CREATE TABLE IF NOT EXISTS node_notes (
  node_id TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- M4.5 auth: server-side session tokens (DB-backed cookies).
-- Token is a 32-byte URL-safe random (base64url). Sliding 30-day idle expiry —
-- expires_at is bumped alongside last_seen_at on each authed request.
-- See docs/design.md 2026-05-01 for rationale.
CREATE TABLE IF NOT EXISTS auth_sessions (
  token TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at
  ON auth_sessions(expires_at);
`;

db.exec(SCHEMA_SQL);

// M6 phase 2 migration: pre-M6 DBs created `node_notes` without a `name`
// column. Add it nullable + backfill from `nodes.name`. Fresh DBs created via
// SCHEMA_SQL above already have the column declared NOT NULL, so the check is
// a no-op there. We can't retroactively make the migrated column NOT NULL
// without a full table rebuild, but the application-level invariant (setNote
// always supplies a non-null name on insert) keeps the data clean.
{
  const cols = db.prepare("PRAGMA table_info(node_notes)").all() as {
    name: string;
  }[];
  const hasNameCol = cols.some((c) => c.name === "name");
  if (!hasNameCol) {
    db.exec(`
      ALTER TABLE node_notes ADD COLUMN name TEXT;
      UPDATE node_notes
         SET name = (SELECT name FROM nodes WHERE nodes.id = node_notes.node_id)
       WHERE name IS NULL;
    `);
  }
}

const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
const nanoid = customAlphabet(alphabet, 12);
export const newNodeId = () => `node_${nanoid()}`;
export const newEdgeId = () => `edge_${nanoid()}`;

export const NODE_TYPES = [
  "Person",
  "Place",
  "Device",
  "Project",
  "Task",
  "Event",
  "Preference",
  "Document",
  "Topic",
  "Organization",
  "Pet",
] as const;

export const FACT_SOURCES = [
  "user_statement",
  "agent_inference",
  "seed",
  "bulk_import",
] as const;
export type FactSource = (typeof FACT_SOURCES)[number];

export const EDGE_TYPES = [
  "KNOWS",
  "LIVES_WITH",
  "WORKS_AT",
  "OWNS",
  "LOCATED_IN",
  "PART_OF",
  "RELATES_TO",
  "SCHEDULED_FOR",
  "ASSIGNED_TO",
  "PREFERS",
  "DEPENDS_ON",
  "MENTIONED_IN",
] as const;

export interface Node {
  id: string;
  type: string;
  name: string;
  props: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface Edge {
  id: string;
  fromId: string;
  toId: string;
  type: string;
  props: Record<string, unknown>;
  confidence: number;
  createdAt: number;
}

interface NodeRow {
  id: string;
  type: string;
  name: string;
  props_json: string;
  created_at: number;
  updated_at: number;
}

interface EdgeRow {
  id: string;
  from_id: string;
  to_id: string;
  type: string;
  props_json: string;
  confidence: number;
  created_at: number;
}

function nodeFromRow(row: NodeRow): Node {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    props: JSON.parse(row.props_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function edgeFromRow(row: EdgeRow): Edge {
  return {
    id: row.id,
    fromId: row.from_id,
    toId: row.to_id,
    type: row.type,
    props: JSON.parse(row.props_json),
    confidence: row.confidence,
    createdAt: row.created_at,
  };
}

export function addNode(input: {
  type: string;
  name: string;
  props?: Record<string, unknown>;
}): Node {
  const id = newNodeId();
  const now = Date.now();
  const props_json = JSON.stringify(input.props ?? {});

  db.prepare(
    `INSERT INTO nodes (id, type, name, props_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, input.type, input.name, props_json, now, now);

  return {
    id,
    type: input.type,
    name: input.name,
    props: input.props ?? {},
    createdAt: now,
    updatedAt: now,
  };
}

export function addEdge(input: {
  fromId: string;
  toId: string;
  type: string;
  props?: Record<string, unknown>;
  confidence?: number;
}): Edge {
  const id = newEdgeId();
  const now = Date.now();
  const props_json = JSON.stringify(input.props ?? {});
  const confidence = input.confidence ?? 1.0;

  db.prepare(
    `INSERT INTO edges (id, from_id, to_id, type, props_json, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.fromId, input.toId, input.type, props_json, confidence, now);

  return {
    id,
    fromId: input.fromId,
    toId: input.toId,
    type: input.type,
    props: input.props ?? {},
    confidence,
    createdAt: now,
  };
}

export function getNode(id: string): Node | null {
  const row = db.prepare(`SELECT * FROM nodes WHERE id = ?`).get(id) as
    | NodeRow
    | undefined;
  return row ? nodeFromRow(row) : null;
}

export function findNodeByName(name: string, type?: string): Node | null {
  const row = (
    type
      ? db
          .prepare(`SELECT * FROM nodes WHERE name = ? AND type = ? LIMIT 1`)
          .get(name, type)
      : db.prepare(`SELECT * FROM nodes WHERE name = ? LIMIT 1`).get(name)
  ) as NodeRow | undefined;
  return row ? nodeFromRow(row) : null;
}

export function search(opts: {
  query: string;
  types?: string[];
  limit?: number;
}): Node[] {
  const limit = opts.limit ?? 10;
  const ftsQuery = opts.query
    .split(/\s+/)
    .filter(Boolean)
    .map((tok) => `${tok.replace(/["*]/g, "")}*`)
    .join(" ");

  if (!ftsQuery) return [];

  let sql = `
    SELECT n.* FROM nodes_fts f
    JOIN nodes n ON n.id = f.id
    WHERE nodes_fts MATCH ?
  `;
  const params: unknown[] = [ftsQuery];

  if (opts.types && opts.types.length > 0) {
    sql += ` AND n.type IN (${opts.types.map(() => "?").join(",")})`;
    params.push(...opts.types);
  }

  sql += ` LIMIT ?`;
  params.push(limit);

  const rows = db.prepare(sql).all(...params) as NodeRow[];
  return rows.map(nodeFromRow);
}

export function neighbors(opts: {
  nodeId: string;
  edgeTypes?: string[];
  direction?: "in" | "out" | "both";
}): { edge: Edge; node: Node }[] {
  const direction = opts.direction ?? "both";
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (direction === "out" || direction === "both") {
    conditions.push("from_id = ?");
    params.push(opts.nodeId);
  }
  if (direction === "in" || direction === "both") {
    conditions.push("to_id = ?");
    params.push(opts.nodeId);
  }

  let sql = `SELECT * FROM edges WHERE (${conditions.join(" OR ")})`;

  if (opts.edgeTypes && opts.edgeTypes.length > 0) {
    sql += ` AND type IN (${opts.edgeTypes.map(() => "?").join(",")})`;
    params.push(...opts.edgeTypes);
  }

  const edgeRows = db.prepare(sql).all(...params) as EdgeRow[];
  const result: { edge: Edge; node: Node }[] = [];
  const nodeStmt = db.prepare(`SELECT * FROM nodes WHERE id = ?`);

  for (const row of edgeRows) {
    const otherId = row.from_id === opts.nodeId ? row.to_id : row.from_id;
    const nodeRow = nodeStmt.get(otherId) as NodeRow | undefined;
    if (nodeRow) {
      result.push({ edge: edgeFromRow(row), node: nodeFromRow(nodeRow) });
    }
  }
  return result;
}

function findOrCreateNode(spec: { nameOrId: string; type?: string }): {
  node: Node;
  created: boolean;
} {
  if (spec.nameOrId.startsWith("node_")) {
    const found = getNode(spec.nameOrId);
    if (found) return { node: found, created: false };
  }
  const found = findNodeByName(spec.nameOrId, spec.type);
  if (found) return { node: found, created: false };
  if (!spec.type) {
    throw new Error(
      `Cannot create node "${spec.nameOrId}" without a type — provide a type or pass an existing node ID.`,
    );
  }
  return { node: addNode({ type: spec.type, name: spec.nameOrId }), created: true };
}

export function link(input: {
  a: { nameOrId: string; type?: string };
  b: { nameOrId: string; type?: string };
  edgeType: string;
  edgeProps?: Record<string, unknown>;
  confidence?: number;
}): {
  a: Node;
  b: Node;
  edge: Edge;
  created: { aCreated: boolean; bCreated: boolean };
} {
  const aRes = findOrCreateNode(input.a);
  const bRes = findOrCreateNode(input.b);
  const edge = addEdge({
    fromId: aRes.node.id,
    toId: bRes.node.id,
    type: input.edgeType,
    props: input.edgeProps,
    confidence: input.confidence,
  });
  return {
    a: aRes.node,
    b: bRes.node,
    edge,
    created: { aCreated: aRes.created, bCreated: bRes.created },
  };
}

export function updateNode(input: {
  id: string;
  name?: string;
  props?: Record<string, unknown>;
}): Node {
  const existing = getNode(input.id);
  if (!existing) throw new Error(`Node ${input.id} not found`);
  const newName = input.name ?? existing.name;
  const newProps = input.props ?? existing.props;
  const now = Date.now();
  db.prepare(
    `UPDATE nodes SET name = ?, props_json = ?, updated_at = ? WHERE id = ?`,
  ).run(newName, JSON.stringify(newProps), now, input.id);
  return { ...existing, name: newName, props: newProps, updatedAt: now };
}

export function deleteNode(id: string): { deleted: boolean; edgesRemoved: number } {
  const node = getNode(id);
  if (!node) return { deleted: false, edgesRemoved: 0 };

  const edgeRows = db
    .prepare(`SELECT id FROM edges WHERE from_id = ? OR to_id = ?`)
    .all(id, id) as { id: string }[];
  const edgeIds = edgeRows.map((r) => r.id);

  const tx = db.transaction(() => {
    if (edgeIds.length > 0) {
      const placeholders = edgeIds.map(() => "?").join(",");
      db.prepare(
        `DELETE FROM provenance WHERE fact_kind = 'edge' AND fact_id IN (${placeholders})`,
      ).run(...edgeIds);
    }
    db.prepare(`DELETE FROM provenance WHERE fact_kind = 'node' AND fact_id = ?`).run(id);
    db.prepare(`DELETE FROM nodes WHERE id = ?`).run(id);
  });
  tx();

  return { deleted: true, edgesRemoved: edgeIds.length };
}

export function findNodesByName(name: string): Node[] {
  const rows = db.prepare(`SELECT * FROM nodes WHERE name = ?`).all(name) as NodeRow[];
  return rows.map(nodeFromRow);
}

export interface MergeNodesResult {
  target: Node;
  sourcesMerged: string[];
  edgesRewritten: number;
  edgesDropped: number;
  targetCreated: boolean;
}

/**
 * Collapse N source nodes into a single target node in one transaction.
 *
 * Resolution: if an existing node already matches `target.name`+`target.type`
 * AND isn't itself a source, we merge into it (`targetCreated: false`).
 * Otherwise we mint a fresh target node (`targetCreated: true`). Either way,
 * `target.body` overwrites `node_notes(target.id)` verbatim.
 *
 * Edge handling:
 * - Each edge whose `from_id`/`to_id` references a source has those endpoints
 *   rewritten to point at the target.
 * - Self-loops produced by the rewrite (e.g. an edge between two sources, or
 *   a source's edge already pointing at the target) are dropped along with
 *   their provenance rows.
 * - Duplicates produced by the rewrite — i.e. another edge with the same
 *   `(from_id, to_id, type)` already exists after collapse — are dropped along
 *   with their provenance rows. The earliest-rewritten edge wins.
 *
 * Provenance: every `fact_kind='node'` row whose `fact_id` is a source gets
 * its `fact_id` rewritten to the target with `source_ref` overwritten as
 * `merged_from_<sourceId>` so the trail of "this target absorbed these"
 * survives. Edge provenance rows for kept edges are untouched (the edge id
 * doesn't change, only its endpoints); dropped edges' provenance is removed.
 *
 * Cleanup: source nodes are deleted last; FK cascades clear `node_embeddings`,
 * `node_layout`, and `node_notes` for them. Edges are already rewritten or
 * dropped by that point, so the cascade on `edges` is a no-op. Provenance
 * has no FK; node provenance was migrated above, edge provenance was cleared
 * for dropped edges.
 *
 * Embeddings for the target are NOT regenerated here — callers should kick off
 * a background `embedNode(target)` after the transaction commits, mirroring
 * the posture of `record-fact` / KG import. The synchronous boundary stays
 * tight so the user's approval-click latency doesn't depend on Voyage.
 *
 * Throws if `sourceIds` is empty, contains an unknown id, or if any source
 * coincides with a pre-existing target match (i.e. you can't merge a node
 * into itself).
 */
export function mergeNodes(
  sourceIds: string[],
  target: { name: string; type: string; body: string },
): MergeNodesResult {
  if (sourceIds.length === 0) {
    throw new Error("mergeNodes: sourceIds must not be empty");
  }
  const dedupedSourceIds = Array.from(new Set(sourceIds));
  if (dedupedSourceIds.length !== sourceIds.length) {
    throw new Error("mergeNodes: sourceIds contains duplicates");
  }

  // Validate sources exist up front. Cheaper than failing mid-transaction.
  for (const sid of sourceIds) {
    const n = getNode(sid);
    if (!n) throw new Error(`mergeNodes: source node ${sid} not found`);
  }

  let edgesRewritten = 0;
  let edgesDropped = 0;
  let targetId = "";
  let targetCreated = false;

  const tx = db.transaction(() => {
    // Resolve / create target. We look for an existing (name, type) match
    // that isn't itself a source — that handles the common case where the
    // target already exists as one of the sources OR as an entirely separate
    // node (e.g. user already has Topic:React, sources are
    // Topic:react + Topic:reactjs).
    const existing = db
      .prepare(`SELECT id FROM nodes WHERE name = ? AND type = ?`)
      .all(target.name, target.type) as { id: string }[];
    const sourceSet = new Set(sourceIds);
    const reusable = existing.find((r) => !sourceSet.has(r.id));

    if (reusable) {
      targetId = reusable.id;
      targetCreated = false;
    } else {
      // No reusable target; create a fresh one. Don't reuse a source id even
      // if it matches name+type — sources are about to be deleted, and the
      // bookkeeping (edge rewrites, provenance migration) is much simpler if
      // the target id is distinct from every source id from the start.
      const fresh = addNode({ type: target.type, name: target.name });
      targetId = fresh.id;
      targetCreated = true;
      recordProvenance({
        factId: targetId,
        factKind: "node",
        source: "user_statement",
        sourceRef: `merge_target(${sourceIds.join(",")})`,
      });
    }

    // Rewrite edges. We process source-touching edges one at a time so the
    // dedup check against the kept set sees the in-progress mutations.
    const edgeRows = db
      .prepare(
        `SELECT id, from_id, to_id, type FROM edges
         WHERE from_id IN (${sourceIds.map(() => "?").join(",")})
            OR to_id   IN (${sourceIds.map(() => "?").join(",")})`,
      )
      .all(...sourceIds, ...sourceIds) as {
      id: string;
      from_id: string;
      to_id: string;
      type: string;
    }[];

    const updateEdgeStmt = db.prepare(
      `UPDATE edges SET from_id = ?, to_id = ? WHERE id = ?`,
    );
    const deleteEdgeStmt = db.prepare(`DELETE FROM edges WHERE id = ?`);
    const deleteEdgeProvStmt = db.prepare(
      `DELETE FROM provenance WHERE fact_kind = 'edge' AND fact_id = ?`,
    );
    const findDupStmt = db.prepare(
      `SELECT id FROM edges
        WHERE from_id = ? AND to_id = ? AND type = ? AND id != ?
        LIMIT 1`,
    );

    for (const e of edgeRows) {
      const newFrom = sourceSet.has(e.from_id) ? targetId : e.from_id;
      const newTo = sourceSet.has(e.to_id) ? targetId : e.to_id;

      // Self-loop after collapse — drop. Common when sources had edges among
      // themselves (e.g. duplicate Person nodes that "KNOWS" each other).
      if (newFrom === newTo) {
        deleteEdgeStmt.run(e.id);
        deleteEdgeProvStmt.run(e.id);
        edgesDropped++;
        continue;
      }

      // Duplicate after collapse — another edge already covers this triple.
      // Could be a pre-existing edge on the target, or a sibling edge from a
      // prior iteration of this loop that also rewrote to the same triple.
      const dup = findDupStmt.get(newFrom, newTo, e.type, e.id) as
        | { id: string }
        | undefined;
      if (dup) {
        deleteEdgeStmt.run(e.id);
        deleteEdgeProvStmt.run(e.id);
        edgesDropped++;
        continue;
      }

      updateEdgeStmt.run(newFrom, newTo, e.id);
      edgesRewritten++;
    }

    // Migrate node provenance: every source's node-fact rows reattach to the
    // target with a merge annotation. Done after edge rewrites so an UPDATE
    // failure (which shouldn't happen — fact_id has no FK) wouldn't leave us
    // halfway. The annotation overwrites any prior `source_ref`; if a row
    // had useful context there we lose it, but in practice the source_ref
    // for node-kind provenance is null almost always (set only by
    // `recordFact` paths that pass it explicitly).
    const updateNodeProvStmt = db.prepare(
      `UPDATE provenance
          SET fact_id = ?, source_ref = ?
        WHERE fact_kind = 'node' AND fact_id = ?`,
    );
    for (const sid of sourceIds) {
      updateNodeProvStmt.run(targetId, `merged_from_${sid}`, sid);
    }

    // Overwrite the target's note with the unified body. setNote is INSERT
    // ... ON CONFLICT, so it works whether the target had a prior note or
    // not. Empty body is allowed — caller may have intentionally consolidated
    // to nothing — but we route through setNote (not deleteNote) so the row
    // exists with the merge timestamp; downstream listings that filter on
    // empty bodies handle the empty case.
    setNote(targetId, target.body);

    // Finally, drop the source nodes. FK cascades clear their embeddings,
    // layout, and notes. Edges have all been rewritten away from sources, so
    // the cascade on edges does nothing. Provenance for sources was migrated
    // above; nothing should remain.
    const deleteNodeStmt = db.prepare(`DELETE FROM nodes WHERE id = ?`);
    for (const sid of sourceIds) {
      deleteNodeStmt.run(sid);
    }
  });
  tx();

  const finalTarget = getNode(targetId);
  if (!finalTarget) {
    // Shouldn't happen — we either reused or created the target inside the
    // tx. Defensive throw rather than a non-null assertion.
    throw new Error(`mergeNodes: target ${targetId} missing after merge`);
  }

  return {
    target: finalTarget,
    sourcesMerged: sourceIds,
    edgesRewritten,
    edgesDropped,
    targetCreated,
  };
}

export interface KgExport {
  exportedAt: number;
  nodes: Node[];
  edges: Edge[];
  provenance: {
    factId: string;
    factKind: "node" | "edge";
    source: string;
    sourceRef: string | null;
    createdAt: number;
  }[];
}

export function exportKg(): KgExport {
  const nodeRows = db.prepare(`SELECT * FROM nodes`).all() as NodeRow[];
  const edgeRows = db.prepare(`SELECT * FROM edges`).all() as EdgeRow[];
  const provRows = db
    .prepare(`SELECT fact_id, fact_kind, source, source_ref, created_at FROM provenance`)
    .all() as {
    fact_id: string;
    fact_kind: "node" | "edge";
    source: string;
    source_ref: string | null;
    created_at: number;
  }[];
  return {
    exportedAt: Date.now(),
    nodes: nodeRows.map(nodeFromRow),
    edges: edgeRows.map(edgeFromRow),
    provenance: provRows.map((p) => ({
      factId: p.fact_id,
      factKind: p.fact_kind,
      source: p.source,
      sourceRef: p.source_ref,
      createdAt: p.created_at,
    })),
  };
}

/**
 * Bulk-import a KG snapshot produced by `exportKg()`. Wraps everything in a
 * single transaction so a partial failure rolls back cleanly.
 *
 * Merge strategy:
 * - `replaceAll: false` (default): skip nodes whose (name, type) pair already
 *   exists in the DB; create everything else with fresh IDs (the export carries
 *   arbitrary IDs that may collide with current rows). Edges are rewritten via
 *   an old-id → new-id map; an edge whose endpoint maps to neither a freshly
 *   inserted node nor an existing-by-(name,type) row is dropped.
 * - `replaceAll: true`: wipes nodes/edges/provenance/embeddings/layout first,
 *   then inserts everything from the snapshot with fresh IDs.
 *
 * Embeddings are NOT carried in the export (they're regenerable), so the
 * caller is expected to call `embedNodes(insertedNodes)` after a successful
 * import.
 *
 * Returns counts and the freshly inserted nodes (so the HTTP layer can kick
 * off background re-embedding without re-querying the DB).
 */
export interface KgImportResult {
  nodesInserted: number;
  nodesSkipped: number;
  edgesInserted: number;
  edgesSkipped: number;
  insertedNodes: Node[];
}

export function importKg(
  snapshot: { nodes: Node[]; edges: Edge[] },
  opts: { replaceAll?: boolean } = {},
): KgImportResult {
  const replaceAll = opts.replaceAll === true;
  const insertedNodes: Node[] = [];
  let nodesSkipped = 0;
  let edgesInserted = 0;
  let edgesSkipped = 0;
  // Maps imported (snapshot) node IDs to the IDs they resolve to in the live
  // DB — either a freshly minted ID (insert) or the existing row's ID (skip).
  const idMap = new Map<string, string>();

  const tx = db.transaction(() => {
    if (replaceAll) {
      // Order: child rows before parent. node_layout / node_embeddings cascade
      // off nodes(id), but provenance and edges don't (provenance has no FK at
      // all; edges cascade via from_id/to_id, but explicit DELETE is clearer
      // and lets us count rows if we ever want to log it).
      db.exec(`
        DELETE FROM node_embeddings;
        DELETE FROM node_layout;
        DELETE FROM provenance;
        DELETE FROM edges;
        DELETE FROM nodes;
      `);
    }

    const findExistingStmt = db.prepare(
      `SELECT id FROM nodes WHERE name = ? AND type = ? LIMIT 1`,
    );
    const insertNodeStmt = db.prepare(
      `INSERT INTO nodes (id, type, name, props_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const insertEdgeStmt = db.prepare(
      `INSERT INTO edges (id, from_id, to_id, type, props_json, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertProvStmt = db.prepare(
      `INSERT INTO provenance (fact_id, fact_kind, source, source_ref, created_at) VALUES (?, ?, ?, ?, ?)`,
    );

    const now = Date.now();

    for (const n of snapshot.nodes) {
      // Skip path: a row with the same (name, type) already exists. We only
      // hit this branch when replaceAll=false (otherwise we wiped the table).
      if (!replaceAll) {
        const existing = findExistingStmt.get(n.name, n.type) as
          | { id: string }
          | undefined;
        if (existing) {
          idMap.set(n.id, existing.id);
          nodesSkipped++;
          continue;
        }
      }

      const newId = newNodeId();
      idMap.set(n.id, newId);
      const propsJson = JSON.stringify(n.props ?? {});
      // Preserve original timestamps when present so `recent` views look
      // sensible after a restore. Fall back to `now` if the snapshot is missing
      // them (e.g., hand-edited JSON).
      const createdAt = typeof n.createdAt === "number" ? n.createdAt : now;
      const updatedAt = typeof n.updatedAt === "number" ? n.updatedAt : now;
      insertNodeStmt.run(newId, n.type, n.name, propsJson, createdAt, updatedAt);
      insertProvStmt.run(newId, "node", "bulk_import", null, now);
      insertedNodes.push({
        id: newId,
        type: n.type,
        name: n.name,
        props: n.props ?? {},
        createdAt,
        updatedAt,
      });
    }

    for (const e of snapshot.edges) {
      const fromId = idMap.get(e.fromId);
      const toId = idMap.get(e.toId);
      // Either endpoint missing means the edge dangles — skip rather than fail
      // the whole import. Most common cause is a malformed snapshot; partial
      // imports (e.g., subset JSON) also benefit from this leniency.
      if (!fromId || !toId) {
        edgesSkipped++;
        continue;
      }
      const newId = newEdgeId();
      const propsJson = JSON.stringify(e.props ?? {});
      const confidence = typeof e.confidence === "number" ? e.confidence : 1.0;
      const createdAt = typeof e.createdAt === "number" ? e.createdAt : now;
      insertEdgeStmt.run(newId, fromId, toId, e.type, propsJson, confidence, createdAt);
      insertProvStmt.run(newId, "edge", "bulk_import", null, now);
      edgesInserted++;
    }
  });
  tx();

  return {
    nodesInserted: insertedNodes.length,
    nodesSkipped,
    edgesInserted,
    edgesSkipped,
    insertedNodes,
  };
}

function dotEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function exportKgDot(): string {
  const data = exportKg();
  const lines: string[] = [
    "digraph kg {",
    "  rankdir=LR;",
    "  node [shape=box, style=rounded];",
  ];
  for (const n of data.nodes) {
    lines.push(`  "${n.id}" [label="${dotEscape(n.name)}\\n(${n.type})"];`);
  }
  for (const e of data.edges) {
    lines.push(`  "${e.fromId}" -> "${e.toId}" [label="${dotEscape(e.type)}"];`);
  }
  lines.push("}");
  return lines.join("\n");
}

export function recentNodes(limit: number = 10): Node[] {
  const rows = db
    .prepare(`SELECT * FROM nodes ORDER BY updated_at DESC LIMIT ?`)
    .all(limit) as NodeRow[];
  return rows.map(nodeFromRow);
}

export interface RecentEdge {
  id: string;
  type: string;
  createdAt: number;
  from: { id: string; name: string; type: string };
  to: { id: string; name: string; type: string };
}

export function recentEdges(limit: number = 10): RecentEdge[] {
  const rows = db
    .prepare(
      `SELECT
         e.id as id, e.type as type, e.created_at as created_at,
         a.id as a_id, a.name as a_name, a.type as a_type,
         b.id as b_id, b.name as b_name, b.type as b_type
       FROM edges e
       JOIN nodes a ON a.id = e.from_id
       JOIN nodes b ON b.id = e.to_id
       ORDER BY e.created_at DESC
       LIMIT ?`,
    )
    .all(limit) as {
    id: string;
    type: string;
    created_at: number;
    a_id: string;
    a_name: string;
    a_type: string;
    b_id: string;
    b_name: string;
    b_type: string;
  }[];
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    createdAt: r.created_at,
    from: { id: r.a_id, name: r.a_name, type: r.a_type },
    to: { id: r.b_id, name: r.b_name, type: r.b_type },
  }));
}

export interface NodeLayoutRow {
  nodeId: string;
  x: number;
  y: number;
}

export function getLayout(): NodeLayoutRow[] {
  const rows = db.prepare(`SELECT node_id, x, y FROM node_layout`).all() as {
    node_id: string;
    x: number;
    y: number;
  }[];
  return rows.map((r) => ({ nodeId: r.node_id, x: r.x, y: r.y }));
}

export function saveLayout(positions: NodeLayoutRow[]): void {
  if (positions.length === 0) return;
  const now = Date.now();
  const stmt = db.prepare(
    `INSERT INTO node_layout (node_id, x, y, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(node_id) DO UPDATE SET
       x = excluded.x, y = excluded.y, updated_at = excluded.updated_at`,
  );
  const tx = db.transaction(() => {
    for (const p of positions) {
      stmt.run(p.nodeId, p.x, p.y, now);
    }
  });
  tx();
}

export interface NodeNote {
  nodeId: string;
  name: string;
  body: string;
  updatedAt: string;
}

export function getNote(nodeId: string): NodeNote | null {
  const row = db
    .prepare(`SELECT node_id, name, body, updated_at FROM node_notes WHERE node_id = ?`)
    .get(nodeId) as
    | { node_id: string; name: string; body: string; updated_at: string }
    | undefined;
  return row
    ? { nodeId: row.node_id, name: row.name, body: row.body, updatedAt: row.updated_at }
    : null;
}

/**
 * Upsert a note row. M6 phase 2: `name` is the note's own display label,
 * decoupled from the underlying node's name.
 *
 * - On INSERT (no existing row): `name` defaults to the parent node's name
 *   when omitted. This keeps the editor + agent's `propose_note_edit` flow
 *   (which only knows about the body) sensible without each caller having
 *   to look up the node first.
 * - On UPDATE (row exists): if `name` is omitted, the existing value is
 *   preserved — body-only edits don't clobber a previously-renamed note.
 *
 * Throws if `nodeId` doesn't exist on insert (we need its name as fallback).
 */
export function setNote(nodeId: string, body: string, name?: string): NodeNote {
  const updatedAt = new Date().toISOString();
  const existing = db
    .prepare(`SELECT name FROM node_notes WHERE node_id = ?`)
    .get(nodeId) as { name: string } | undefined;

  let resolvedName: string;
  if (existing) {
    resolvedName = name ?? existing.name;
  } else if (name !== undefined) {
    resolvedName = name;
  } else {
    const node = db.prepare(`SELECT name FROM nodes WHERE id = ?`).get(nodeId) as
      | { name: string }
      | undefined;
    if (!node) {
      throw new Error(`setNote: node ${nodeId} not found and no name provided`);
    }
    resolvedName = node.name;
  }

  db.prepare(
    `INSERT INTO node_notes (node_id, name, body, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(node_id) DO UPDATE SET
       name = excluded.name,
       body = excluded.body,
       updated_at = excluded.updated_at`,
  ).run(nodeId, resolvedName, body, updatedAt);
  return { nodeId, name: resolvedName, body, updatedAt };
}

/**
 * Rename a note without touching its body. Returns null when the note row
 * doesn't exist — callers (the PATCH route) translate that to a 404. The
 * body-only `setNote` upserts a fresh row; rename pointedly does NOT, since
 * a rename of a non-existent note is meaningless (no body to attach the
 * label to).
 */
export function renameNote(nodeId: string, name: string): NodeNote | null {
  const existing = getNote(nodeId);
  if (!existing) return null;
  const updatedAt = new Date().toISOString();
  db.prepare(`UPDATE node_notes SET name = ?, updated_at = ? WHERE node_id = ?`).run(
    name,
    updatedAt,
    nodeId,
  );
  return { nodeId, name, body: existing.body, updatedAt };
}

export function deleteNote(nodeId: string): { deleted: boolean } {
  const info = db.prepare(`DELETE FROM node_notes WHERE node_id = ?`).run(nodeId);
  return { deleted: info.changes > 0 };
}

export function recordProvenance(input: {
  factId: string;
  factKind: "node" | "edge";
  source: FactSource;
  sourceRef?: string;
}): void {
  db.prepare(
    `INSERT INTO provenance (fact_id, fact_kind, source, source_ref, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(input.factId, input.factKind, input.source, input.sourceRef ?? null, Date.now());
}

function encodeVector(vec: number[] | Float32Array): Buffer {
  const f32 = vec instanceof Float32Array ? vec : new Float32Array(vec);
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
}

function decodeVector(buf: Buffer): Float32Array {
  // Copy into a fresh Float32Array so callers don't have to worry about
  // alignment or shared-buffer aliasing with other rows.
  const out = new Float32Array(buf.byteLength / 4);
  out.set(new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4));
  return out;
}

export function upsertEmbedding(input: {
  nodeId: string;
  model: string;
  vector: number[] | Float32Array;
}): void {
  const dim = input.vector.length;
  const blob = encodeVector(input.vector);
  db.prepare(
    `INSERT INTO node_embeddings (node_id, model, vector, dim, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(node_id) DO UPDATE SET
       model = excluded.model,
       vector = excluded.vector,
       dim = excluded.dim,
       updated_at = excluded.updated_at`,
  ).run(input.nodeId, input.model, blob, dim, Date.now());
}

export interface NodeEmbedding {
  nodeId: string;
  model: string;
  vector: Float32Array;
  dim: number;
}

export function getAllEmbeddings(): NodeEmbedding[] {
  const rows = db
    .prepare(`SELECT node_id, model, vector, dim FROM node_embeddings`)
    .all() as { node_id: string; model: string; vector: Buffer; dim: number }[];
  return rows.map((r) => ({
    nodeId: r.node_id,
    model: r.model,
    vector: decodeVector(r.vector),
    dim: r.dim,
  }));
}

export function kgStats(): {
  nodeCount: number;
  edgeCount: number;
  nodeCountsByType: Record<string, number>;
} {
  const nodeCount = (db.prepare(`SELECT COUNT(*) as c FROM nodes`).get() as { c: number })
    .c;
  const edgeCount = (db.prepare(`SELECT COUNT(*) as c FROM edges`).get() as { c: number })
    .c;
  const typeRows = db
    .prepare(`SELECT type, COUNT(*) as c FROM nodes GROUP BY type`)
    .all() as { type: string; c: number }[];
  const nodeCountsByType: Record<string, number> = {};
  for (const r of typeRows) nodeCountsByType[r.type] = r.c;
  return { nodeCount, edgeCount, nodeCountsByType };
}
