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
  /**
   * The note's own display label (M6 phase 2). Decoupled from the
   * underlying node's name — renaming the note doesn't rename the node.
   * Defaults to the node's name when a note is first created via the
   * editor (the server fills it in when the PUT body omits `name`).
   */
  name: string;
  body: string;
  updatedAt: string;
  /**
   * M6 phase 3: optional parent folder. `null` when the note lives at the
   * unfiled root. Folders are pure UI organization — the server never lets
   * the agent see this field.
   */
  folderId: number | null;
}

/**
 * One folder row from `GET /api/kg/folders`. The server returns a flat list;
 * the client assembles it into a tree. `parentId === null` marks a root
 * folder. Folder names are unique per-parent (root-level uniqueness is
 * enforced by a partial index on the server side; collisions surface as
 * 409s from the create/rename endpoints).
 */
export interface NoteFolder {
  id: number;
  name: string;
  parentId: number | null;
  sortOrder: number;
  createdAt: number;
}

/**
 * Result shape of `DELETE /api/kg/folders/:id?mode=…`. Counts mirror what
 * happened: `foldersRemoved` includes the root folder plus every cascaded
 * descendant; `notesAffected` is the number of notes that were either
 * un-filed (mode=unfile) or had their underlying nodes deleted (mode=cascade).
 */
export interface DeleteFolderResult {
  deleted: true;
  foldersRemoved: number;
  notesAffected: number;
}

/**
 * One row in the dashboard `Notes` panel — every node with a non-empty note,
 * ordered by note recency. `preview` is whitespace-collapsed and truncated
 * to ~200 chars (with a trailing ellipsis only when the body actually exceeded
 * the limit). `updatedAt` is the ISO-8601 string from `node_notes.updated_at`.
 *
 * M6 phase 2: `name` is the note's own renamable label, sourced from
 * `node_notes.name` (not the underlying node's name). `type` continues to
 * mirror the node's type — notes don't have their own type.
 *
 * M6 phase 3: `folderId` slots the note into the folder tree. `null` means
 * the note is at the unfiled root.
 */
export interface KgNoteListEntry {
  nodeId: string;
  name: string;
  type: string;
  preview: string;
  updatedAt: string;
  folderId: number | null;
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
  /**
   * Inline-create a new note from the Notes sidebar `+` button (M6 phase 2).
   * Mints a node (default type `Generic`) plus a paired note row in a single
   * server-side transaction. Returns the new `nodeId` so callers can select
   * the freshly-created row and flip straight into split-edit mode.
   *
   * `type` defaults to `Generic` when omitted (the catch-all for unclassified
   * notes — see the M6 phase 2 design log entry). `body` defaults to empty.
   * `folderId` (M6 phase 3) optionally files the new note into a folder; pass
   * `null` or omit to leave it at the unfiled root.
   */
  createNote: (input: {
    name: string;
    type?: string;
    body?: string;
    folderId?: number | null;
  }) =>
    jsonFetch<{
      nodeId: string;
      name: string;
      body: string;
      updatedAt: string;
      folderId: number | null;
    }>(`/api/kg/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  getNote: (id: string) =>
    jsonFetch<{ note: NodeNote | null }>(`/api/kg/node/${id}/note`),
  setNote: (id: string, body: string, name?: string) =>
    jsonFetch<{ note: NodeNote | null }>(`/api/kg/node/${id}/note`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      // Only include `name` in the body when the caller passed one; the
      // server preserves the existing label when the field is absent.
      body: JSON.stringify(name === undefined ? { body } : { body, name }),
    }),
  /**
   * Rename a note without touching its body. Wired to the right-click
   * `Rename` action in phase 3; the route ships in phase 2 so the API
   * surface is complete for callers that want to rename programmatically.
   */
  renameNote: (id: string, name: string) =>
    jsonFetch<{ note: NodeNote }>(`/api/kg/node/${id}/note`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }),
  /**
   * Move a note into / out of a folder (M6 phase 3). `folderId` is the
   * target folder's id, or `null` to un-file the note (back to the root).
   * Wired to drag-and-drop and the right-click move action; round-trips
   * through the same PATCH endpoint as rename so the wire shape stays
   * coherent (`{ name?, folderId? }`).
   */
  moveNote: (id: string, folderId: number | null) =>
    jsonFetch<{ note: NodeNote }>(`/api/kg/node/${id}/note`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId }),
    }),
  deleteNote: (id: string) =>
    jsonFetch<{ deleted: boolean }>(`/api/kg/node/${id}/note`, {
      method: "DELETE",
    }),
  /**
   * List every folder. Server returns a flat array; the client assembles
   * the tree from `parentId` pointers. Tree-expansion state lives in
   * localStorage (no server-side state for it).
   */
  listFolders: () => jsonFetch<NoteFolder[]>("/api/kg/folders"),
  /**
   * Create a folder. `parentId === null` (or omitted) creates a root folder.
   * 409 on duplicate name within the same parent.
   */
  createFolder: (input: { name: string; parentId?: number | null }) =>
    jsonFetch<NoteFolder>("/api/kg/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  /**
   * Rename / move a folder in one round-trip. At least one of `name` or
   * `parentId` must be supplied. 409 on rename collision; 400 on a
   * cycle-creating move.
   */
  patchFolder: (id: number, input: { name?: string; parentId?: number | null }) =>
    jsonFetch<NoteFolder>(`/api/kg/folders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  /**
   * Delete a folder. `mode: "unfile"` (default) drops the folder + all
   * descendant folders but un-files contained notes (folder_id → NULL).
   * `mode: "cascade"` also deletes the underlying nodes for every contained
   * note — irreversible, so it's gated by the UI's non-empty-delete prompt.
   */
  deleteFolder: (id: number, mode: "unfile" | "cascade" = "unfile") =>
    jsonFetch<DeleteFolderResult>(`/api/kg/folders/${id}?mode=${mode}`, {
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
