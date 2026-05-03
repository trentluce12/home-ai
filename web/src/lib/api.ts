// In dev, VITE_SERVER_URL points cross-port at the Hono server (`http://localhost:3001`).
// In prod, the SPA is served from the same origin as the API (see `m45-static-serving`),
// so an empty string makes all `${SERVER_URL}/api/...` calls relative.
export const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "";

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
  formatted: string;
};

export type DoneEvent = {
  kind: "done";
  id: string;
  totalCostUsd: number | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
};

export type MemoryEvent = ToolEvent | ContextEvent | DoneEvent;

export interface SessionSummary {
  id: string;
  title: string;
  lastModified: number;
}

export interface RecentEdge {
  id: string;
  type: string;
  createdAt: number;
  from: { id: string; name: string; type: string };
  to: { id: string; name: string; type: string };
}

export interface NodeLayoutEntry {
  nodeId: string;
  x: number;
  y: number;
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

export interface NodeNote {
  nodeId: string;
  body: string;
  updatedAt: string;
}

/**
 * One row in the dashboard `Notes` panel — every node with a non-empty note,
 * ordered by note recency. `preview` is whitespace-collapsed and truncated
 * to ~200 chars (with a trailing ellipsis only when the body actually exceeded
 * the limit). `updatedAt` is the ISO-8601 string from `node_notes.updated_at`.
 */
export interface KgNoteListEntry {
  nodeId: string;
  name: string;
  type: string;
  preview: string;
  updatedAt: string;
}

/**
 * Mirrors the server's `ApprovalDecision` union (server/src/approval.ts).
 * Kept as a duplicated definition rather than a shared types package — the
 * project doesn't have a cross-workspace types layer and this surface is small.
 */
export type ApprovalDecision =
  | { decision: "approve" }
  | { decision: "deny" }
  | { decision: "tweak"; tweakText: string };

/** SSE-side payload for `approval_request` events. */
export interface ApprovalRequest {
  requestId: string;
  kind: string;
  payload: unknown;
}

// `credentials: "include"` is required so the browser sends/receives the
// `home_ai_session` cookie cross-origin in dev (Vite :5173 → server :3001).
// In prod the SPA is same-origin so it's a no-op there. Always set so callers
// don't have to care about the deployment shape.
async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${SERVER_URL}${path}`, {
    credentials: "include",
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`);
  }
  return res.json() as Promise<T>;
}

export interface AuthMeResponse {
  authenticated: boolean;
}

/**
 * Login response shape. Server returns `{ ok: true }` on success; on failure
 * we throw with the status, which the caller distinguishes (401 vs 429 vs 500)
 * to pick the right user-facing copy.
 */
export class LoginError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "LoginError";
  }
}

export const api = {
  me: () => jsonFetch<AuthMeResponse>("/api/auth/me"),
  login: async (password: string): Promise<void> => {
    const res = await fetch(`${SERVER_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      // Don't surface response text — both unconfigured-server (500) and
      // wrong-password (401) should look like a failed login from the
      // user's POV. Caller picks copy off the status alone.
      throw new LoginError(res.status, `Login failed (${res.status})`);
    }
  },
  logout: () =>
    jsonFetch<{ ok: true }>("/api/auth/logout", {
      method: "POST",
    }),
  listSessions: () => jsonFetch<SessionSummary[]>("/api/sessions"),
  sessionHistory: (id: string) => jsonFetch<Message[]>(`/api/sessions/${id}/history`),
  deleteSession: (id: string) =>
    jsonFetch<{ ok: true }>(`/api/sessions/${id}`, { method: "DELETE" }),
  renameSession: (id: string, title: string) =>
    jsonFetch<{ ok: true; title: string }>(`/api/sessions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    }),
  recentNodes: (limit = 20) => jsonFetch<KgNode[]>(`/api/kg/recent?limit=${limit}`),
  recentEdges: (limit = 8) =>
    jsonFetch<RecentEdge[]>(`/api/kg/recent-edges?limit=${limit}`),
  stats: () => jsonFetch<KgStats>("/api/kg/stats"),
  byName: (name: string) =>
    jsonFetch<NodeWithNeighbors[]>(`/api/kg/by-name/${encodeURIComponent(name)}`),
  deleteNode: (id: string) =>
    jsonFetch<{ deleted: boolean; edgesRemoved: number }>(`/api/kg/node/${id}`, {
      method: "DELETE",
    }),
  recordFact: (input: {
    a: { name: string; type: string };
    b: { name: string; type: string };
    edgeType: string;
  }) =>
    jsonFetch<{ ok: true; edge: KgEdge }>(`/api/kg/record-fact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  exportUrl: (format: "json" | "dot") => `${SERVER_URL}/api/kg/export?format=${format}`,
  importKg: (input: { nodes: unknown[]; edges: unknown[]; replaceAll?: boolean }) =>
    jsonFetch<{
      ok: true;
      nodesInserted: number;
      nodesSkipped: number;
      edgesInserted: number;
      edgesSkipped: number;
      replaceAll: boolean;
    }>(`/api/kg/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  graph: () => jsonFetch<GraphData>("/api/kg/graph"),
  nodeDetail: (id: string) => jsonFetch<NodeDetail>(`/api/kg/node/${id}`),
  getLayout: () => jsonFetch<NodeLayoutEntry[]>("/api/kg/layout"),
  saveLayout: (positions: NodeLayoutEntry[]) =>
    jsonFetch<{ ok: true; saved: number }>(`/api/kg/layout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ positions }),
    }),
  notes: () => jsonFetch<KgNoteListEntry[]>("/api/kg/notes"),
  getNote: (id: string) =>
    jsonFetch<{ note: NodeNote | null }>(`/api/kg/node/${id}/note`),
  setNote: (id: string, body: string) =>
    jsonFetch<{ note: NodeNote | null }>(`/api/kg/node/${id}/note`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    }),
  deleteNote: (id: string) =>
    jsonFetch<{ deleted: boolean }>(`/api/kg/node/${id}/note`, {
      method: "DELETE",
    }),
  respondApproval: (requestId: string, decision: ApprovalDecision) =>
    jsonFetch<{ ok: true }>(`/api/approval/${encodeURIComponent(requestId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(decision),
    }),
};

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
