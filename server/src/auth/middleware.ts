import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { bumpLastSeen, lookupSession } from "./store.js";

/**
 * Auth gate for the `/api/*` surface.
 *
 * Reads the `home_ai_session` cookie, looks the token up in `auth_sessions`,
 * and rejects with 401 if it's missing or expired. On success, bumps
 * `last_seen_at` (sliding 30-day idle expiry — see `bumpLastSeen` in
 * `auth/store.ts`) and yields to the next handler.
 *
 * Mounted at `/api/*` in `server/src/index.ts`. The auth routes themselves
 * (`/api/auth/login`, `/logout`, `/me`) bypass the gate via the prefix check
 * below — they have to be reachable without a session for the auth flow to
 * work at all. The check is on `c.req.path`, which is the request URL path
 * regardless of how the route was registered.
 *
 * See docs/design.md 2026-05-01 for the broader auth design.
 */

const COOKIE_NAME = "home_ai_session";
const AUTH_PREFIX = "/api/auth/";

export const requireAuth: MiddlewareHandler = async (c, next) => {
  // Auth routes must be reachable without a session — login itself can't
  // require a prior login. Match on the full path so a future nested route
  // (e.g. `/api/auth/whatever`) inherits the bypass automatically.
  if (c.req.path.startsWith(AUTH_PREFIX)) {
    return next();
  }

  const token = getCookie(c, COOKIE_NAME);
  if (!token) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const session = lookupSession(token);
  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  // Slide the expiry forward. A null return means the row vanished between
  // lookup and bump (concurrent revoke / sweep) — treat as unauthenticated.
  const bumped = bumpLastSeen(token);
  if (!bumped) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  await next();
};
