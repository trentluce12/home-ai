# Login / logout / me routes + bcrypt + rate limit

**Why:** Endpoint surface for the auth flow. Depends on `m45-auth-sessions-table`.

**What:** `POST /api/auth/login` (body `{password}`, verify against `HOME_AI_PASSWORD_HASH` bcrypt env, set HttpOnly Secure SameSite=Lax cookie `home_ai_session=<token>`, return `{ok}`). `POST /api/auth/logout` (revoke session). `GET /api/auth/me` (`{authenticated: bool}` for SPA gating). Per-IP rate limit on `/login` (5 attempts / 15 min) via tiny in-memory bucket — no Redis needed at single-user scale.

**Files:** `server/src/routes/auth.ts` (new) or inline in `server/src/index.ts`

**Estimate:** TBD
