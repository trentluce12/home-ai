export const SERVER_URL = "http://localhost:3001";

export type Message = { role: "user" | "assistant"; content: string };

export type ToolEvent = {
  kind: "tool";
  id: string;
  name: string;
  input: unknown;
};

export type ContextEvent = {
  kind: "context";
  id: string;
  nodeCount: number;
  edgeCount: number;
  rootNames: string[];
};

export type MemoryEvent = ToolEvent | ContextEvent;

export interface SessionSummary {
  id: string;
  title: string;
  lastModified: number;
}

export interface KgNode {
  id: string;
  type: string;
  name: string;
  props: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface KgEdge {
  id: string;
  fromId: string;
  toId: string;
  type: string;
  props: Record<string, unknown>;
  confidence: number;
  createdAt: number;
}

export interface KgStats {
  nodeCount: number;
  edgeCount: number;
  nodeCountsByType: Record<string, number>;
}

export interface NodeWithNeighbors {
  node: KgNode;
  neighbors: { edge: KgEdge; node: KgNode }[];
}

export interface GraphData {
  nodes: { id: string; name: string; type: string }[];
  edges: { id: string; fromId: string; toId: string; type: string }[];
}

export interface NodeDetail {
  node: KgNode;
  neighbors: { edge: KgEdge; node: KgNode }[];
  provenance: { source: string; sourceRef: string | null; createdAt: number }[];
}

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${SERVER_URL}${path}`, init);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  listSessions: () => jsonFetch<SessionSummary[]>("/sessions"),
  sessionHistory: (id: string) => jsonFetch<Message[]>(`/sessions/${id}/history`),
  deleteSession: (id: string) =>
    jsonFetch<{ ok: true }>(`/sessions/${id}`, { method: "DELETE" }),
  recentNodes: (limit = 20) => jsonFetch<KgNode[]>(`/kg/recent?limit=${limit}`),
  stats: () => jsonFetch<KgStats>("/kg/stats"),
  byName: (name: string) =>
    jsonFetch<NodeWithNeighbors[]>(`/kg/by-name/${encodeURIComponent(name)}`),
  deleteNode: (id: string) =>
    jsonFetch<{ deleted: boolean; edgesRemoved: number }>(`/kg/node/${id}`, {
      method: "DELETE",
    }),
  exportUrl: (format: "json" | "dot") => `${SERVER_URL}/kg/export?format=${format}`,
  graph: () => jsonFetch<GraphData>("/kg/graph"),
  nodeDetail: (id: string) => jsonFetch<NodeDetail>(`/kg/node/${id}`),
};
