import {
  foldSessionSummary,
  type SessionStore,
  type SessionKey,
  type SessionStoreEntry,
  type SessionSummaryEntry,
} from "@anthropic-ai/claude-agent-sdk";
import { db } from "../kg/db.js";

const subpathOf = (k: SessionKey): string => k.subpath ?? "";

interface SessionRow {
  project_key: string;
  session_id: string;
  created_at: number;
  last_active: number;
  archived_at: number | null;
  summary_json: string | null;
}

const upsertSessionStmt = db.prepare(
  `INSERT INTO sessions (project_key, session_id, created_at, last_active)
   VALUES (?, ?, ?, ?)
   ON CONFLICT(project_key, session_id) DO UPDATE SET last_active = excluded.last_active`,
);

const insertEntryStmt = db.prepare(
  `INSERT OR IGNORE INTO session_entries
     (project_key, session_id, subpath, uuid, type, timestamp, payload_json)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
);

const getSessionStmt = db.prepare(
  `SELECT * FROM sessions WHERE project_key = ? AND session_id = ?`,
);

const updateSummaryStmt = db.prepare(
  `UPDATE sessions SET summary_json = ? WHERE project_key = ? AND session_id = ?`,
);

const loadEntriesStmt = db.prepare(
  `SELECT payload_json FROM session_entries
   WHERE project_key = ? AND session_id = ? AND subpath = ?
   ORDER BY id ASC`,
);

const sessionExistsStmt = db.prepare(
  `SELECT 1 FROM session_entries
   WHERE project_key = ? AND session_id = ? AND subpath = ?
   LIMIT 1`,
);

const listSessionsStmt = db.prepare(
  `SELECT session_id, last_active FROM sessions
   WHERE project_key = ?
   ORDER BY last_active DESC`,
);

const listSummariesStmt = db.prepare(
  `SELECT summary_json FROM sessions
   WHERE project_key = ? AND summary_json IS NOT NULL
   ORDER BY last_active DESC`,
);

const deleteSessionStmt = db.prepare(
  `DELETE FROM sessions WHERE project_key = ? AND session_id = ?`,
);

const deleteSubpathStmt = db.prepare(
  `DELETE FROM session_entries
   WHERE project_key = ? AND session_id = ? AND subpath = ?`,
);

const listSubkeysStmt = db.prepare(
  `SELECT DISTINCT subpath FROM session_entries
   WHERE project_key = ? AND session_id = ? AND subpath != ''`,
);

export const sqliteSessionStore: SessionStore = {
  async append(key: SessionKey, entries: SessionStoreEntry[]): Promise<void> {
    const sub = subpathOf(key);
    const now = Date.now();

    const tx = db.transaction(() => {
      // Ensure parent session row exists; bump last_active.
      upsertSessionStmt.run(key.projectKey, key.sessionId, now, now);

      for (const e of entries) {
        const timestamp =
          typeof (e as { timestamp?: unknown }).timestamp === "string"
            ? (e as { timestamp: string }).timestamp
            : null;
        insertEntryStmt.run(
          key.projectKey,
          key.sessionId,
          sub,
          e.uuid ?? null,
          e.type,
          timestamp,
          JSON.stringify(e),
        );
      }

      const prevRow = getSessionStmt.get(key.projectKey, key.sessionId) as
        | SessionRow
        | undefined;
      const prev: SessionSummaryEntry | undefined = prevRow?.summary_json
        ? (JSON.parse(prevRow.summary_json) as SessionSummaryEntry)
        : undefined;
      const next = foldSessionSummary(prev, key, entries);
      updateSummaryStmt.run(JSON.stringify(next), key.projectKey, key.sessionId);
    });

    tx();
  },

  async load(key: SessionKey): Promise<SessionStoreEntry[] | null> {
    const sub = subpathOf(key);
    const exists = sessionExistsStmt.get(key.projectKey, key.sessionId, sub);
    if (!exists) return null;
    const rows = loadEntriesStmt.all(key.projectKey, key.sessionId, sub) as {
      payload_json: string;
    }[];
    return rows.map((r) => JSON.parse(r.payload_json) as SessionStoreEntry);
  },

  async listSessions(
    projectKey: string,
  ): Promise<{ sessionId: string; mtime: number }[]> {
    const rows = listSessionsStmt.all(projectKey) as {
      session_id: string;
      last_active: number;
    }[];
    return rows.map((r) => ({ sessionId: r.session_id, mtime: r.last_active }));
  },

  async listSessionSummaries(projectKey: string): Promise<SessionSummaryEntry[]> {
    const rows = listSummariesStmt.all(projectKey) as { summary_json: string }[];
    return rows.map((r) => JSON.parse(r.summary_json) as SessionSummaryEntry);
  },

  async delete(key: SessionKey): Promise<void> {
    const sub = subpathOf(key);
    if (sub === "") {
      // Main transcript — drop the session row, cascading entries (and subagents).
      deleteSessionStmt.run(key.projectKey, key.sessionId);
    } else {
      deleteSubpathStmt.run(key.projectKey, key.sessionId, sub);
    }
  },

  async listSubkeys(key: {
    projectKey: string;
    sessionId: string;
  }): Promise<string[]> {
    const rows = listSubkeysStmt.all(key.projectKey, key.sessionId) as {
      subpath: string;
    }[];
    return rows.map((r) => r.subpath);
  },
};
