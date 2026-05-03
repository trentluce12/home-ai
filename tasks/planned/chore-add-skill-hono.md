# Add hono project skill

**Why:** Area 2 — Hono-specific patterns (route style, middleware order, SSE handling) should auto-load when editing server code.

**What:** Create `.claude/skills/hono/SKILL.md` with:

- **Name:** `hono`
- **Description (with TRIGGER):** Triggers when editing files under `server/src/**/*.ts` OR files that import `hono`.
- **Body — rules:**
  - Route style: `app.get('/path', async (c) => { ... })` with explicit returns
  - Middleware order: CORS (dev only) → auth (when added in M4.5) → routes
  - Error handling: throw `HTTPException` for known errors; let unhandled throw bubble for 500s
  - SSE: stream via `c.body(stream)` with manual `data: ` framing; terminate cleanly on consumer disconnect (already established pattern in `server/src/index.ts`)
  - Cookie helpers: use Hono's `setCookie` / `getCookie` (don't hand-roll headers)
  - Cross-reference: see existing `/api/chat` and `/api/sessions` routes as canonical examples

**Files:** `.claude/skills/hono/SKILL.md` (new)

**Estimate:** 30 min

**Dependencies:** none

**Smoke steps:** Edit `server/src/index.ts`; verify skill loads.

---

**Status:** pending
**Started:** —

## Notes
