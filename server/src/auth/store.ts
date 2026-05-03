import { randomBytes } from "node:crypto";
import { db } from "../kg/db.js";

/**
 * Session lifecycle helpers for M4.5 password auth.
 *
 * Tokens are 32 bytes of CSPRNG entropy, encoded as URL-safe base64 (no
 * padding) so they slot cleanly into an HttpOnly cookie value without
 * percent-encoding. Sliding 30-day idle expiry: `expires_at` is recomputed
 * alongside `last_seen_at` on every bump, so an actively-used session never
 * times out and an idle one falls off after 30 days.
 *
 * See docs/design.md 2026-05-01 for the broader auth design.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
export const IDLE_EXPIRY_MS = 30 * DAY_MS;

export interface AuthSession {
  token: string;
  createdAt: number;
  expiresAt: number;
  lastSeenAt: number;
}

interface AuthSessionRow {
  token: string;
  created_at: number;
  expires_at: number;
  last_seen_at: number;
}

const insertStmt = db.prepare(
  `INSERT INTO auth_sessions (token, created_at, expires_at, last_seen_at)
   VALUES (?, ?, ?, ?)`,
);

const selectStmt = db.prepare(`SELECT * FROM auth_sessions WHERE token = ?`);

const bumpStmt = db.prepare(
  `UPDATE auth_sessions
     SET last_seen_at = ?, expires_at = ?
   WHERE token = ? AND expires_at > ?`,
);

const deleteStmt = db.prepare(`DELETE FROM auth_sessions WHERE token = ?`);

const sweepStmt = db.prepare(`DELETE FROM auth_sessions WHERE expires_at <= ?`);

function rowToSession(row: AuthSessionRow): AuthSession {
  return {
    token: row.token,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastSeenAt: row.last_seen_at,
  };
}

/**
 * Generate a fresh 32-byte URL-safe token (base64url, no padding).
 * Exposed for tests; callers normally just use `createSession()`.
 */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Create a new session. Returns the inserted row; the caller is responsible
 * for delivering the token to the client (typically via Set-Cookie).
 */
export function createSession(): AuthSession {
  const now = Date.now();
  const session: AuthSession = {
    token: generateToken(),
    createdAt: now,
    expiresAt: now + IDLE_EXPIRY_MS,
    lastSeenAt: now,
  };
  insertStmt.run(session.token, session.createdAt, session.expiresAt, session.lastSeenAt);
  return session;
}

/**
 * Look up a session by token. Returns null when the token is unknown OR when
 * it has expired (caller doesn't need to distinguish — expired sessions are
 * unauthenticated).
 */
export function lookupSession(token: string): AuthSession | null {
  const row = selectStmt.get(token) as AuthSessionRow | undefined;
  if (!row) return null;
  if (row.expires_at <= Date.now()) return null;
  return rowToSession(row);
}

/**
 * Bump `last_seen_at` and slide `expires_at` forward by 30 days. Returns the
 * updated session, or null if the token is unknown / already expired (no row
 * is touched in the expired case so a sweep can still claim it cleanly).
 */
export function bumpLastSeen(token: string): AuthSession | null {
  const now = Date.now();
  const newExpiresAt = now + IDLE_EXPIRY_MS;
  const result = bumpStmt.run(now, newExpiresAt, token, now);
  if (result.changes === 0) return null;
  // Re-read so the caller gets the canonical row (createdAt is unchanged).
  const row = selectStmt.get(token) as AuthSessionRow | undefined;
  return row ? rowToSession(row) : null;
}

/**
 * Revoke (hard-delete) a session. Returns true if a row was removed.
 */
export function revokeSession(token: string): boolean {
  const result = deleteStmt.run(token);
  return result.changes > 0;
}

/**
 * Drop all sessions whose expiry has elapsed. Safe to run on a timer; cheap
 * because of the `idx_auth_sessions_expires_at` index. Returns the number of
 * rows removed.
 */
export function sweepExpiredSessions(): number {
  const result = sweepStmt.run(Date.now());
  return Number(result.changes);
}
