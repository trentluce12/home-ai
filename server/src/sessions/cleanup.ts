import { db } from "../kg/db.js";

const DAY_MS = 24 * 60 * 60 * 1000;

interface CleanupOptions {
  archiveDays?: number;
  deleteDays?: number;
}

export interface CleanupResult {
  archived: number;
  deleted: number;
  archiveDays: number;
  deleteDays: number;
}

/**
 * Sweep stale sessions. Archive marks them hidden from the default sidebar but
 * keeps them resumable; delete drops them entirely. Pass 0 (or leave the env
 * var unset to default 0) to disable that step.
 *
 * Defaults: archive after 30 days idle, delete after 180.
 */
export function cleanupSessions(opts: CleanupOptions = {}): CleanupResult {
  const archiveDays = opts.archiveDays ?? Number(process.env.SESSION_ARCHIVE_DAYS ?? 30);
  const deleteDays = opts.deleteDays ?? Number(process.env.SESSION_DELETE_DAYS ?? 180);
  const now = Date.now();

  let archived = 0;
  let deleted = 0;

  if (deleteDays > 0) {
    const cutoff = now - deleteDays * DAY_MS;
    const result = db.prepare(`DELETE FROM sessions WHERE last_active < ?`).run(cutoff);
    deleted = Number(result.changes);
  }

  if (archiveDays > 0) {
    const cutoff = now - archiveDays * DAY_MS;
    const result = db
      .prepare(
        `UPDATE sessions SET archived_at = ?
         WHERE archived_at IS NULL AND last_active < ?`,
      )
      .run(now, cutoff);
    archived = Number(result.changes);
  }

  return { archived, deleted, archiveDays, deleteDays };
}
