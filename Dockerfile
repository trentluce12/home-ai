# syntax=docker/dockerfile:1.7

# ─── Stage 1: build ─────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /build

# better-sqlite3 needs python + a C toolchain to compile its native binding.
# Pinning to alpine's package set keeps this layer cacheable.
RUN apk add --no-cache python3 make g++

# Install the full workspace (incl. dev deps) — tsc and vite live in devDeps.
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN npm ci

# Source then build. tsc emits server/dist; vite emits web/dist. Each
# workspace owns its own tsconfig.json — no root-level config to copy.
COPY server ./server
COPY web ./web
RUN npm run build

# Prune to production deps only — better-sqlite3's compiled binding stays in
# node_modules/better-sqlite3/build, so re-pruning here is faster than running
# a fresh `npm ci --omit=dev` from scratch.
RUN npm prune --omit=dev


# ─── Stage 2: runtime ───────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

# server/src/kg/db.ts hardcodes `resolve(__dirname, "../../../data")`. With the
# compiled file at /server/dist/kg/db.js, that resolves to /data — matching the
# writable volume mount below. If the path ever changes, this layout breaks.
WORKDIR /

# Workspace package.jsons — node resolves `better-sqlite3` etc. against these.
COPY --from=builder /build/package.json ./package.json
COPY --from=builder /build/server/package.json ./server/package.json
COPY --from=builder /build/web/package.json ./web/package.json

# Production deps (root-hoisted by npm workspaces). better-sqlite3's prebuilt
# native binding rides along.
COPY --from=builder /build/node_modules ./node_modules

# Built artifacts only — no source, no devDeps.
COPY --from=builder /build/server/dist ./server/dist
COPY --from=builder /build/web/dist ./web/dist

# /data is the single writable surface. Pre-create + chown so the non-root
# user can write kg.sqlite + WAL/SHM sidecars even with a read-only root FS.
# uid/gid 1000 is the `node` user that ships in node:22-alpine.
RUN mkdir -p /data && chown -R node:node /data

USER node

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

# Healthcheck hits GET / — the server returns "home-ai server" with 200.
# wget is in the base alpine image; using --spider avoids buffering the body.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --spider http://localhost:${PORT}/ || exit 1

# Direct node entry — skips the npm script wrapper and its signal-handling quirks.
CMD ["node", "server/dist/index.js"]
