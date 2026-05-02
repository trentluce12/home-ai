# Auth middleware on `/api/*`

**Why:** Gate all non-auth API surface behind a session check. Without this, the auth routes are decorative.

**What:** Hono middleware that reads the `home_ai_session` cookie, looks up the token in `auth_sessions`, rejects with 401 if missing/expired, and bumps `last_seen_at` on success (sliding expiry). Apply to all `/api/*` routes except the three auth routes themselves.

**Files:** `server/src/auth/middleware.ts` (new), `server/src/index.ts`

**Estimate:** TBD
