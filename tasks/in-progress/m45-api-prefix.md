# Move routes under `/api/*` prefix

**Why:** Clean separation between API and SPA routes — required so the catch-all static serving (`m45-static-serving`) doesn't shadow API endpoints.

**What:** Mount `/chat` → `/api/chat`, `/sessions[/...]` → `/api/sessions[/...]`, `/kg/*` → `/api/kg/*`. Update `web/src/lib/api.ts` `SERVER_URL` to `import.meta.env.VITE_SERVER_URL ?? ""` (empty string in prod for relative paths; keep `http://localhost:3001` in `.env.development`). Drop the hardcoded CORS origin in prod (single-origin, no preflight).

**Files:** `server/src/index.ts`, `web/src/lib/api.ts`, `web/.env.development` (new or edited)

**Estimate:** TBD
