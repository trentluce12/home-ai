import { db, search, neighbors, type Node, type Edge } from "./db.js";

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "of", "to", "in", "on", "at", "by",
  "for", "with", "from", "as", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could", "should",
  "may", "might", "can", "i", "you", "he", "she", "it", "we", "they", "me", "him",
  "her", "us", "them", "my", "your", "his", "its", "our", "their", "this", "that",
  "these", "those", "what", "which", "who", "whom", "whose", "when", "where", "why",
  "how", "all", "any", "some", "no", "not", "so", "than", "too", "very", "just",
  "about", "tell", "know", "think", "say", "said", "tells", "told",
]);

function tokenize(text: string): string[] {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  return Array.from(new Set(tokens));
}

export interface RetrievedSubgraph {
  rootNodes: Node[];
  edges: { edge: Edge; from: Node; to: Node }[];
  formatted: string;
  summary: { nodeCount: number; edgeCount: number; rootNames: string[] };
}

const EMPTY: RetrievedSubgraph = {
  rootNodes: [],
  edges: [],
  formatted: "",
  summary: { nodeCount: 0, edgeCount: 0, rootNames: [] },
};

export function retrieveSubgraph(
  userText: string,
  opts: { maxRoots?: number; maxNodes?: number } = {},
): RetrievedSubgraph {
  const tokens = tokenize(userText);
  if (tokens.length === 0) return EMPTY;

  const maxRoots = opts.maxRoots ?? 5;
  const maxNodes = opts.maxNodes ?? 20;

  const seen = new Map<string, Node>();
  const roots: Node[] = [];
  for (const tok of tokens) {
    const matches = search({ query: tok, limit: maxRoots });
    for (const node of matches) {
      if (seen.has(node.id)) continue;
      seen.set(node.id, node);
      roots.push(node);
      if (roots.length >= maxRoots) break;
    }
    if (roots.length >= maxRoots) break;
  }

  if (roots.length === 0) return EMPTY;

  const nodeStmt = db.prepare(`SELECT * FROM nodes WHERE id = ?`);
  const edges: { edge: Edge; from: Node; to: Node }[] = [];
  const edgeIds = new Set<string>();

  for (const root of roots) {
    if (seen.size >= maxNodes) break;
    const hops = neighbors({ nodeId: root.id });
    for (const hop of hops) {
      if (edgeIds.has(hop.edge.id)) continue;
      edgeIds.add(hop.edge.id);

      const fromNode = hop.edge.fromId === root.id
        ? root
        : seen.get(hop.edge.fromId) ?? rowToNode(nodeStmt.get(hop.edge.fromId));
      const toNode = hop.edge.toId === root.id
        ? root
        : seen.get(hop.edge.toId) ?? rowToNode(nodeStmt.get(hop.edge.toId));
      if (!fromNode || !toNode) continue;

      seen.set(fromNode.id, fromNode);
      seen.set(toNode.id, toNode);
      edges.push({ edge: hop.edge, from: fromNode, to: toNode });
      if (seen.size >= maxNodes) break;
    }
  }

  const orphanRoots = roots.filter((r) =>
    !edges.some((e) => e.from.id === r.id || e.to.id === r.id),
  );

  const lines: string[] = [];
  for (const e of edges) {
    lines.push(`- ${e.from.name} (${e.from.type}) ${e.edge.type} ${e.to.name} (${e.to.type})`);
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
    },
  };
}

function rowToNode(row: unknown): Node | null {
  if (!row || typeof row !== "object") return null;
  const r = row as {
    id: string;
    type: string;
    name: string;
    props_json: string;
    created_at: number;
    updated_at: number;
  };
  return {
    id: r.id,
    type: r.type,
    name: r.name,
    props: JSON.parse(r.props_json),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
