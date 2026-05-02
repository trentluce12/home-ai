# Hono serves `web/dist` at `/`

**Why:** Single-origin deployment — frontend + API share an origin so there's no CORS in prod and only one container to host.

**What:** Hono catch-all that serves files from `web/dist` (with `index.html` fallback for SPA routes), but does *not* shadow `/api/*`. Drop the CORS middleware entirely in prod (kept in dev where Vite serves on a different port).

**Files:** `server/src/index.ts`

**Estimate:** TBD
