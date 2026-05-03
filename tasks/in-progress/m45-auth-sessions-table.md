# `auth_sessions` table + session lifecycle helpers

**Why:** Foundation for password-based auth in M4.5. Server-side session tracking with sliding expiry; lands before the routes that consume it.

**What:** New table `auth_sessions(token TEXT PK, created_at, expires_at, last_seen_at)` joined to the existing `db.exec(SCHEMA_SQL)` block. `token` is a 32-byte URL-safe random. Helpers: create / lookup / bump-last-seen / revoke / sweep-expired. 30-day idle expiry. See the 2026-05-01 design log entry for rationale.

**Files:** `server/src/auth/store.ts` (new), `server/src/kg/db.ts` (schema additions)

**Estimate:** TBD
