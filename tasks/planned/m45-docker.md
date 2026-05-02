# Multi-stage Dockerfile + .dockerignore + docker-compose.yml

**Why:** Reproducible production image and a way to run the prod-shape stack locally before deploying to a real host.

**What:** Multi-stage Dockerfile:
- Builder: `node:22-alpine`, `npm ci` at workspace root, `npm run build` (server tsc + `vite build`).
- Runtime: `node:22-alpine`, copy `server/dist`, `web/dist`, prod-only `node_modules`, and `package.json`s. Entrypoint: `node server/dist/index.js` (skip the npm script overhead).
- Non-root user (uid 1000), read-only root FS, `/data` is the only writable mount (holds `kg.sqlite` + WAL/SHM sidecars).
- Single exposed port from `PORT` env (default 8080 in prod, dev keeps 3001).
- Healthcheck `GET /` → 200. No host docker socket, no host network.

`.dockerignore` excludes `node_modules`, `dist`, `.env*`, `data/`, `.git`.

`docker-compose.yml` for local prod-shape testing: volume mount `/data`, env file, single service.

**Files:** `Dockerfile` (new), `.dockerignore` (new), `docker-compose.yml` (new)

**Estimate:** TBD
