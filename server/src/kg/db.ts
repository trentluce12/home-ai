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
`;

db.exec(SCHEMA_SQL);

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

export const FACT_SOURCES = ["user_statement", "agent_inference", "seed"] as const;
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
