import { Hono } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import bcrypt from "bcrypt";
import {
  IDLE_EXPIRY_MS,
  createSession,
  lookupSession,
  revokeSession,
} from "../auth/store.js";

/**
 * Auth routes for M4.5 password auth.
 *
 * Single-user, single password. The server reads `HOME_AI_PASSWORD_HASH`
 * (a bcrypt hash) from env at boot — no user table, the env hash *is* the
 * credential set. On successful `POST /api/auth/login` we mint a fresh
 * session in the `auth_sessions` table (see `server/src/auth/store.ts`)
 * and set an HttpOnly `home_ai_session` cookie. The /api auth middleware
 * (next story) reads the cookie, looks up the row, and 401s on miss/expire.
 *
 * See docs/design.md 2026-05-01 for the broader design.
 */

const COOKIE_NAME = "home_ai_session";

// Rate limiting: 5 attempts per IP per 15 minutes. In-memory bucket — fine
// at single-user scale; an authed user only rarely hits this surface and an
// attacker burning attempts against one IP gets locked out fast.
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX_ATTEMPTS = 5;

interface RateBucket {
  // Timestamps (ms) of attempts within the current window. Pruned lazily on
  // every read so the map size tracks only currently-rate-limited IPs.
  attempts: number[];
}

const rateBuckets = new Map<string, RateBucket>();

function recordAttemptAndCheck(ip: string): { limited: boolean; retryAfterMs: number } {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const bucket = rateBuckets.get(ip) ?? { attempts: [] };
  // Drop stale entries before evaluating.
  bucket.attempts = bucket.attempts.filter((t) => t > cutoff);
  bucket.attempts.push(now);
  rateBuckets.set(ip, bucket);
  if (bucket.attempts.length > RATE_LIMIT_MAX_ATTEMPTS) {
    const oldest = bucket.attempts[0] ?? now;
    return {
      limited: true,
      retryAfterMs: Math.max(0, oldest + RATE_LIMIT_WINDOW_MS - now),
    };
  }
  return { limited: false, retryAfterMs: 0 };
}

/** Resolve the client IP from Hono's conninfo helper, falling back to a sentinel. */
function clientIp(remoteAddress: string | undefined): string {
  // `undefined` shouldn't happen on a real connection, but guard anyway so
  // the bucket gets a deterministic key rather than throwing.
  return remoteAddress ?? "unknown";
}

/** Common cookie options for both `setCookie` and `deleteCookie`. */
function cookieOptions() {
  return {
    httpOnly: true,
    // Set Secure in production — the cookie must travel over HTTPS in
    // prod, but localhost dev runs over http, where Secure would block it.
    secure: process.env.NODE_ENV === "production",
    sameSite: "Lax" as const,
    path: "/",
  };
}

const auth = new Hono();

auth.post("/login", async (c) => {
  const ip = clientIp(getConnInfo(c).remote.address);
  const { limited, retryAfterMs } = recordAttemptAndCheck(ip);
  if (limited) {
    const retryAfterSec = Math.ceil(retryAfterMs / 1000);
    c.header("Retry-After", String(retryAfterSec));
    return c.json({ error: "Too many login attempts" }, 429);
  }

  const expectedHash = process.env.HOME_AI_PASSWORD_HASH;
  if (!expectedHash) {
    // Misconfigured server — refuse rather than silently accept anything.
    console.error("[auth] HOME_AI_PASSWORD_HASH is not set; refusing all logins");
    return c.json({ error: "Auth not configured" }, 500);
  }

  const body = await c.req.json<{ password?: unknown }>().catch(() => null);
  const password = typeof body?.password === "string" ? body.password : "";

  // Always run bcrypt.compare even on empty input so the response time
  // doesn't leak whether the field was provided. bcrypt.compare returns
  // false for any input against a real hash; running it on the empty
  // string is equivalent to a wrong password.
  const ok = await bcrypt.compare(password, expectedHash).catch((err) => {
    console.error("[auth] bcrypt.compare failed:", err);
    return false;
  });
  if (!ok) {
    return c.json({ error: "Invalid password" }, 401);
  }

  const session = createSession();
  setCookie(c, COOKIE_NAME, session.token, {
    ...cookieOptions(),
    maxAge: Math.floor(IDLE_EXPIRY_MS / 1000),
  });
  return c.json({ ok: true });
});

auth.post("/logout", (c) => {
  const token = getCookie(c, COOKIE_NAME);
  if (token) revokeSession(token);
  // Always clear the cookie, even if there was no token / lookup miss —
  // the client treats a 200 here as "you're logged out now."
  deleteCookie(c, COOKIE_NAME, cookieOptions());
  return c.json({ ok: true });
});

auth.get("/me", (c) => {
  const token = getCookie(c, COOKIE_NAME);
  if (!token) return c.json({ authenticated: false });
  const session = lookupSession(token);
  return c.json({ authenticated: session !== null });
});

export { auth as authRoutes };
