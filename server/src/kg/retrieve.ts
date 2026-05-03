import { db, getAllEmbeddings, neighbors, type Node, type Edge } from "./db.js";
import { embedQuery } from "../embeddings/index.js";

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "if",
  "of",
  "to",
  "in",
  "on",
  "at",
  "by",
  "for",
  "with",
  "from",
  "as",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "can",
  "i",
  "you",
  "he",
  "she",
  "it",
  "we",
  "they",
  "me",
  "him",
  "her",
  "us",
  "them",
  "my",
  "your",
  "his",
  "its",
  "our",
  "their",
  "this",
  "that",
  "these",
  "those",
  "what",
  "which",
  "who",
  "whom",
  "whose",
  "when",
  "where",
  "why",
  "how",
  "all",
  "any",
  "some",
  "no",
  "not",
  "so",
  "than",
  "too",
  "very",
  "just",
  "about",
  "tell",
  "know",
  "think",
  "say",
  "said",
  "tells",
  "told",
]);

function tokenize(text: string): string[] {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  return Array.from(new Set(tokens));
}

interface NodeRow {
  id: string;
  type: string;
  name: string;
  props_json: string;
  created_at: number;
  updated_at: number;
}

function rowToNode(row: NodeRow): Node {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    props: JSON.parse(row.props_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function ftsRankedIds(userText: string, limit: number): { id: string; node: Node }[] {
  const tokens = tokenize(userText);
  const expr = tokens.map((t) => `${t}*`).join(" OR ");
  if (!expr) return [];
  const rows = db
    .prepare(
      `SELECT n.* FROM nodes_fts f JOIN nodes n ON n.id = f.id
       WHERE nodes_fts MATCH ? ORDER BY rank LIMIT ?`,
    )
    .all(expr, limit) as NodeRow[];
  return rows.map((r) => ({ id: r.id, node: rowToNode(r) }));
}

function cosine(a: Float32Array, b: Float32Array): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i++) {
    const av = a[i]!;
    const bv = b[i]!;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

function cosineRankedIds(
  queryVec: Float32Array,
  limit: number,
): { id: string; score: number }[] {
  const all = getAllEmbeddings();
  if (all.length === 0) return [];
  const scored = all.map((e) => ({ id: e.nodeId, score: cosine(queryVec, e.vector) }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

const RRF_K = 60;

function rrfFuse(lists: string[][]): Map<string, number> {
  const scores = new Map<string, number>();
  for (const list of lists) {
    for (let i = 0; i < list.length; i++) {
      const id = list[i]!;
      const rank = i + 1;
      scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + rank));
    }
  }
  return scores;
}

export interface RetrievedSubgraph {
  rootNodes: Node[];
  edges: { edge: Edge; from: Node; to: Node }[];
  formatted: string;
  summary: {
    nodeCount: number;
    edgeCount: number;
    rootNames: string[];
    retrievers: ("fts" | "cosine")[];
  };
}

const EMPTY: RetrievedSubgraph = {
  rootNodes: [],
  edges: [],
  formatted: "",
  summary: { nodeCount: 0, edgeCount: 0, rootNames: [], retrievers: [] },
};

export async function retrieveSubgraph(
  userText: string,
  opts: { maxRoots?: number; maxNodes?: number; perRetrieverLimit?: number } = {},
): Promise<RetrievedSubgraph> {
  const maxRoots = opts.maxRoots ?? 5;
  const maxNodes = opts.maxNodes ?? 20;
  const perRetrieverLimit = opts.perRetrieverLimit ?? 20;

  const ftsHits = ftsRankedIds(userText, perRetrieverLimit);

  let queryVec: Float32Array | null = null;
  try {
    const raw = await embedQuery(userText);
    queryVec = new Float32Array(raw);
  } catch (err) {
    console.warn("[retrieve] query embedding failed; FTS-only fallback:", err);
  }

  const cosineHits = queryVec ? cosineRankedIds(queryVec, perRetrieverLimit) : [];

  const retrievers: ("fts" | "cosine")[] = [];
  if (ftsHits.length > 0) retrievers.push("fts");
  if (cosineHits.length > 0) retrievers.push("cosine");

  const fused = rrfFuse([ftsHits.map((h) => h.id), cosineHits.map((h) => h.id)]);

  if (fused.size === 0) return EMPTY;

  const ranked = Array.from(fused.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxRoots)
    .map(([id]) => id);

  // Hydrate roots — prefer nodes already loaded via FTS hits, fall back to a
  // direct lookup for cosine-only hits.
  const ftsNodeMap = new Map<string, Node>();
  for (const h of ftsHits) ftsNodeMap.set(h.id, h.node);
  const nodeStmt = db.prepare(`SELECT * FROM nodes WHERE id = ?`);

  const seen = new Map<string, Node>();
  const roots: Node[] = [];
  for (const id of ranked) {
    const node = ftsNodeMap.get(id) ?? rowToNodeOrNull(nodeStmt.get(id));
    if (!node) continue;
    seen.set(node.id, node);
    roots.push(node);
  }

  if (roots.length === 0) return EMPTY;

  const edges: { edge: Edge; from: Node; to: Node }[] = [];
  const edgeIds = new Set<string>();

  for (const root of roots) {
    if (seen.size >= maxNodes) break;
    const hops = neighbors({ nodeId: root.id });
    for (const hop of hops) {
      if (edgeIds.has(hop.edge.id)) continue;
      edgeIds.add(hop.edge.id);

      const fromNode =
        hop.edge.fromId === root.id
          ? root
          : (seen.get(hop.edge.fromId) ?? rowToNodeOrNull(nodeStmt.get(hop.edge.fromId)));
      const toNode =
        hop.edge.toId === root.id
          ? root
          : (seen.get(hop.edge.toId) ?? rowToNodeOrNull(nodeStmt.get(hop.edge.toId)));
      if (!fromNode || !toNode) continue;

      seen.set(fromNode.id, fromNode);
      seen.set(toNode.id, toNode);
      edges.push({ edge: hop.edge, from: fromNode, to: toNode });
      if (seen.size >= maxNodes) break;
    }
  }

  const orphanRoots = roots.filter(
    (r) => !edges.some((e) => e.from.id === r.id || e.to.id === r.id),
  );

  const lines: string[] = [];
  for (const e of edges) {
    lines.push(
      `- ${e.from.name} (${e.from.type}) ${e.edge.type} ${e.to.name} (${e.to.type})`,
    );
  }
  for (const r of orphanRoots) {
    lines.push(`- ${r.name} (${r.type})`);
  }

  return {
    rootNodes: roots,
    edges,
    formatted: lines.join("\n"),
    summary: {
      nodeCount: seen.size,
      edgeCount: edges.length,
      rootNames: roots.map((r) => r.name),
      retrievers,
    },
  };
}

function rowToNodeOrNull(row: unknown): Node | null {
  if (!row || typeof row !== "object") return null;
  return rowToNode(row as NodeRow);
}
