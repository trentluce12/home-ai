---
name: hono
description: Hono HTTP framework conventions for the home-ai server (route style, middleware order, SSE streaming, error handling, cookie helpers). TRIGGER when editing files under `server/src/**/*.ts` OR files that import `hono` (or any `hono/*` submodule). SKIP for client-side React code or non-server TypeScript.
---

You are editing the home-ai Hono server. Follow these conventions — they match the canonical patterns already established in `server/src/index.ts`.

## Route style

- One handler per route, registered directly on the `app` instance: `app.get('/path', async (c) => { ... })` / `app.post(...)` / `app.delete(...)` / `app.patch(...)`.
- Always `return` the response explicitly. Hono will not auto-return — a missing `return` produces a 404.
- Use `c.json(...)` for JSON responses, `c.text(...)` for plain text, `c.body(...)` for raw streams or custom content types.
- Read params with `c.req.param('id')`, query with `c.req.query('foo')`, body with `await c.req.json<T>()`. Type the body inline.
- For request bodies that may be malformed, chain `.catch(() => null)` (or a sensible default) and validate before use — see `/kg/record-fact` and `/kg/layout` for the pattern.

## Middleware order

Order matters — middleware runs top-to-bottom. The home-ai stack is:

1. **CORS (dev only)** — `app.use("*", cors({ origin: "http://localhost:5173" }))`. Drops to a no-op / removed in prod once `m45-api-prefix` lands and frontend + API share an origin.
2. **Auth** — added in M4.5 (`m45-auth-middleware`). Checks the `home_ai_session` cookie, rejects with 401 if missing/expired. Skips `/api/auth/*` routes.
3. **Routes** — registered after middleware.

Don't reorder these. CORS must come before auth (preflight has no cookie); auth must come before routes (each route assumes an authed context).

## Error handling

- Throw `HTTPException` (`from "hono/http-exception"`) for known errors with a status code: `throw new HTTPException(400, { message: "bad input" })`.
- Let unhandled exceptions bubble — Hono returns 500. Don't `try/catch` just to log and re-throw; `console.error` in handlers is fine but the throw should propagate.
- For SSE handlers, wrap the streaming work in `try/catch` and emit a final `{ type: "error", message }` SSE event before the stream closes — see the existing `/chat` handler. The connection is already open, so a thrown error wouldn't reach the client.

## SSE streaming

Use Hono's `streamSSE` helper from `hono/streaming` — **not** `c.body(stream)` with hand-rolled `data: ` framing. The helper handles framing, heartbeats, and disconnect cleanup.

```ts
import { streamSSE } from "hono/streaming";

return streamSSE(c, async (stream) => {
  await stream.writeSSE({ data: JSON.stringify({ type: "...", ... }) });
  // ... loop, write more events ...
});
```

- Always JSON-encode the payload — the consumer (`web/src/lib/api.ts`) parses every event as JSON.
- Use a discriminated `type` field on every event (`"text"`, `"tool_use"`, `"context"`, `"session"`, `"done"`, `"error"`) so the client can switch on it.
- The stream terminates cleanly when the async function returns. If the consumer disconnects, `stream.writeSSE` will reject — let it propagate; `streamSSE` cleans up.
- Never wrap stream events in `new Promise(...)` — see the `anthropic-sdk` skill for why; same anti-pattern applies here.

## Cookie helpers

Use Hono's `setCookie` / `getCookie` from `hono/cookie` — never set `Set-Cookie` headers by hand.

```ts
import { setCookie, getCookie, deleteCookie } from "hono/cookie";

setCookie(c, "home_ai_session", token, {
  httpOnly: true,
  secure: true,
  sameSite: "Lax",
  maxAge: 60 * 60 * 24 * 30,
  path: "/",
});

const token = getCookie(c, "home_ai_session");
```

The auth design (M4.5) standardizes on HttpOnly + Secure + SameSite=Lax — see `docs/design.md` 2026-05-01 entry.

## Cross-reference

The canonical examples in the codebase are:

- `/api/chat` — SSE streaming with the Agent SDK, error handling, multiple event types. (Currently mounted at `/chat`; moves to `/api/chat` when `m45-api-prefix` lands.)
- `/api/sessions` family (`GET`, `GET /:id/history`, `DELETE /:id`, `PATCH /:id`) — REST shape, param/body parsing, validation. (Currently mounted at `/sessions`; same migration.)
- `/api/kg/*` — request body validation with `.catch(() => null)`, type-narrowing before passing to the KG layer.

Read those before adding a new route — match their shape.
