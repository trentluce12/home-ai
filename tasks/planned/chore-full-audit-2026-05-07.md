# Full review audit — security hardening + capability widening (2026-05-07)

**Why:** First full-codebase audit since M6 closed. Surface security/hardening gaps before the next milestone, and queue a backlog of capability widenings to choose from.
**What:** Consolidated review of the entire codebase covering (a) security vulnerabilities + hardening recommendations, (b) code-quality / convention findings, (c) capability-widening proposals. Each item below is sized so it can be split into its own follow-up task when picked up.
**Files:** Audit only — no code changes in this task. Implementation tasks split out as needed.
**Estimate:** Audit content done in this file; implementation follow-ups sized 0.5–2d each.
**Dependencies:** none
**Smoke steps:** N/A — this task ships findings; spawned implementation tasks each carry their own smoke.

---

**Status:** pending
**Started:** —

## Notes

Audit conducted 2026-05-07 against `dev-tl` (HEAD `dbb6884`). Methodology: direct reads of every server-side route + auth + KG + approval module, Dockerfile/compose, package manifests, plus parallel review-agent passes (both stalled at the 600s watchdog but contributed partial findings — captured below).

No critical exploitable vulnerabilities found. The risk surface is dominated by **(a) the agent's privilege model** (`permissionMode: "bypassPermissions"` + Read/Glob/WebFetch in default-prod) and **(b) missing defense-in-depth on the HTTP edge** (no CSP, no body-size caps, single-route rate-limiting). Both manageable with focused hardening tasks; neither is a "drop everything" issue at single-tenant scale.

---

## Security findings

Severity ladder: **High** (clear vulnerability or significant hardening gap) · **Medium** (defense-in-depth) · **Low** (informational).

### High

#### S-H1 — Agent runs with `bypassPermissions` + filesystem + WebFetch

[server/src/index.ts:217](server/src/index.ts:217) sets `permissionMode: "bypassPermissions"`; [server/src/index.ts:70-78](server/src/index.ts:70) enables `Read`, `Glob`, `Grep`, `WebFetch`, `WebSearch` by default in prod. The agent's `cwd` is `PROJECT_DIR` (the project root) so it can read every file the container can see — including `.env` (loaded via dotenv at boot, [server/src/index.ts:32-35](server/src/index.ts:32)), session DB at `data/kg.sqlite`, every source file. **A successful prompt injection (e.g. via WebFetch return content, an Obsidian-vault note, or a poisoned KG entry) would let the model exfiltrate secrets/PII via subsequent tool calls.**

- **Fix (P1):** Restrict the agent's effective filesystem root. Options:
  - Run the SDK with a sandboxed `cwd` (e.g. `/data/agent-scratch`) instead of `PROJECT_DIR`.
  - Drop `Read`/`Glob`/`Grep` from the default-prod allowlist and re-enable per-task via the same `HOME_AI_ALLOW_WRITE_TOOLS`-style gate.
  - Add a path-prefix filter in a `canUseTool` callback (Agent SDK supports it) that blocks reads outside an allowlist.
- **Fix (P2):** Block WebFetch/WebSearch from cloud-metadata addresses (`169.254.169.254`, link-local, RFC1918) — SSRF mitigation. The home server has nothing on its private network today, but defense-in-depth.

#### S-H2 — No CSP / security headers on any response

The Hono app registers no `helmet`-equivalent middleware. The SPA renders agent-generated markdown via `react-markdown` (which sanitizes by default — good), but the response bodies have no `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, or `Permissions-Policy`. **An XSS escape from `react-markdown` (e.g. via a future plugin or rule misconfiguration) would have free rein. Clickjacking is unblocked.**

- **Fix:** Add a `secureHeaders` middleware (Hono has one built in) before all routes. Strict-by-default CSP: `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'` (Tailwind needs inline, audit if removable); add HSTS in prod only; X-Frame-Options DENY; Referrer-Policy strict-origin-when-cross-origin.

#### S-H3 — No body-size limits on any POST endpoint

`/api/chat` ([server/src/index.ts:176](server/src/index.ts:176)), `/api/kg/import` ([server/src/index.ts:1060](server/src/index.ts:1060)), `/api/kg/notes` ([server/src/index.ts:875](server/src/index.ts:875)), `/api/kg/record-fact` ([server/src/index.ts:945](server/src/index.ts:945)) all read `await c.req.json()` without an upper bound. **An authed attacker (or a runaway client bug) can submit a multi-GB body and pin a worker / OOM the container.** Hono's `bodyLimit` middleware exists; not used.

- **Fix:** Apply `bodyLimit({ maxSize: 1_000_000 })` to `/api/*` by default; raise per-route to `50_000_000` for `/api/kg/import`. 413 on overflow.

#### S-H4 — Login rate-limit blind to reverse-proxy IP forwarding

[server/src/routes/auth.ts:81](server/src/routes/auth.ts:81) reads `getConnInfo(c).remote.address` for the rate-limit bucket key. Behind any reverse proxy (Cloudflare Tunnel, nginx, Traefik — the deploy posture documented in M4.5) this resolves to the proxy's IP, not the real client. **Result: a distributed credential-stuffing attack appears as one IP and either (a) gets locked out instantly, breaking legit logins from that proxy, or (b) — if the bucket is small — defeats rate-limiting entirely after a few attempts.**

- **Fix:** Add a `HOME_AI_TRUSTED_PROXIES` env var (CIDR list). When set and the connection's source IP matches, honor `X-Forwarded-For`'s leftmost untrusted hop. Refuse to honor the header from untrusted sources (prevents spoofing).

#### S-H5 — Rate-limit only on login; no caps on chat/import

`/api/chat` calls Anthropic + Voyage on every turn — a runaway client can rack up real cost. `/api/kg/import` accepts arbitrary KG snapshots. `/api/kg/record-fact` calls Voyage on each new node. None are rate-limited. **An authed attacker (or compromised XSS) can drain the Anthropic quota in minutes.**

- **Fix:** Per-route token-bucket on `/api/chat` (e.g. 30 turns / hour / session), `/api/kg/import` (3 / hour), `/api/kg/record-fact` (60 / hour). Surface 429 with `Retry-After`.

#### S-H6 — In-memory rate-limit map and `titledSessions` set grow unboundedly

[server/src/routes/auth.ts:39](server/src/routes/auth.ts:39) `rateBuckets` map and [server/src/index.ts:365](server/src/index.ts:365) `titledSessions` Set are never pruned. Each unique IP / session adds one entry forever. Behind a proxy this is bounded; on a directly-exposed deployment it's a memory-DoS surface. **Worse, `titledSessions` is process-local, so a restart re-runs smart-titling on every session that already had one (cost regression).**

- **Fix:** `setInterval` sweep on `rateBuckets` to drop empty/expired buckets every 5 min. For `titledSessions`, query the SQLite `sessions` table on cache miss instead of caching in memory at all (cheap; index already exists).

### Medium

#### S-M1 — No absolute session expiry

[server/src/auth/store.ts](server/src/auth/store.ts) implements sliding 30-day idle expiry only. A token used at least once every 30 days never auto-revokes. **A leaked cookie remains valid indefinitely.**

- **Fix:** Add `absolute_expires_at` column (e.g. created_at + 90d), check in both `lookupSession` and `bumpLastSeen`. Force re-auth quarterly.

#### S-M2 — Boot-time config validation missing

[server/src/routes/auth.ts:90](server/src/routes/auth.ts:90) checks `HOME_AI_PASSWORD_HASH` per request and 500s if missing. [server/src/index.ts:402](server/src/index.ts:402) checks `ANTHROPIC_API_KEY` only when smart-titling fires. **The server happily boots in a broken state — a misconfigured deploy looks healthy until the first user action.**

- **Fix:** zod-validate `process.env` at boot (see existing `zod` dep in [server/package.json:27](server/package.json:27)). Refuse to start unless `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `HOME_AI_PASSWORD_HASH` are present + non-empty in production. Warn-not-fail in dev.

#### S-M3 — bcrypt cost factor not enforced

The user-supplied `HOME_AI_PASSWORD_HASH` could have any cost. If generated with `-c 4` (default-ish on some tooling), brute-force is cheap.

- **Fix:** At boot, parse the hash's cost prefix (`$2b$<cost>$…`) and warn-or-refuse if `< 12`.

#### S-M4 — FTS5 query string in `kg.search()` allows malformed queries

[server/src/kg/db.ts:411-415](server/src/kg/db.ts:411) strips `"` and `*` but leaves `(`, `)`, `:` (column prefix), `^`, `-` (NOT prefix), `NEAR`. A user query like `name:foo)` blows up FTS5 with a syntax error → 500. SQL injection is **NOT** possible (parameter binding) — this is a robustness issue. Note: the auto-injection path in [retrieve.ts:111-118](server/src/kg/retrieve.ts:111) already strips all non-alphanumerics, so the issue is scoped to the `mcp__kg__search` agent tool path and the `/api/kg/by-name/:name` endpoint.

- **Fix:** Replace the strip with a token-quoted approach: `tokens.map(t => `"${t.replace(/"/g,'""')}"*`).join(' ')`. Same approach as `retrieve.ts` — strip down to safe alphanumerics + double-quote each token.

#### S-M5 — No CSRF token (relies on SameSite=Lax + JSON content-type)

[server/src/routes/auth.ts:73](server/src/routes/auth.ts:73) sets `sameSite: "Lax"`. State-changing routes use POST/PUT/PATCH/DELETE with `application/json` only — modern browsers treat this as a non-simple request requiring CORS preflight, and Lax blocks cross-site cookie attachment. **In practice safe, but** documented mitigation should not depend on accidents.

- **Fix:** Optional. If hardened: add a double-submit CSRF token (cookie + header) on the auth POST routes specifically. For everything else, `SameSite=Strict` would be enough; consider stepping up to Strict.

#### S-M6 — `__Host-` cookie prefix not used

Cookie name is plain `home_ai_session`. With `__Host-` prefix the browser enforces Path=/, Secure, no-Domain — preventing subdomain takeover from injecting a session cookie.

- **Fix:** Rename to `__Host-home_ai_session` in prod. Single-line change in [auth/store.ts](server/src/auth/store.ts) and [auth/middleware.ts](server/src/auth/middleware.ts).

#### S-M7 — `/api/kg/export` returns the full KG including provenance with no audit log

A successful XSS or stolen cookie exfiltrates the entire personal graph in one GET. No log of who/when. Single-tenant, but the audit-log absence is across every sensitive endpoint.

- **Fix:** Add a tiny `audit_log` table — append-only `(ts, route, user_action, details)`. Log: login success/fail, logout, export, forget, import, approval-decision. Read-only surface in the dashboard.

#### S-M8 — `/api/chat` allows SSE keep-open with no idle timeout

If a chat starts but the agent loop hangs (Anthropic 5xx + retry inside the SDK), the SSE stream stays open holding a worker. `stream.onAbort` fires only when the **client** disconnects.

- **Fix:** Wrap the `for await` loop in a `Promise.race` with a 10-min server-side timeout; emit a `{type:"error", message:"timeout"}` SSE event and close.

#### S-M9 — Approval response endpoint trusts `requestId` solely

[server/src/index.ts:334-358](server/src/index.ts:334) — `requestId` is a nanoid (21-char random). Auth gate is just `/api/*` (login required), but **any authed user/tab can resolve any pending approval**. With single-tenant scale this is fine; in a future multi-user world it would be a privilege-escalation seam.

- **Fix (later — flag in design.md):** When multi-user lands, key the resolver by `(requestId, sessionId)` and reject mismatched session.

### Low / Informational

- **S-L1.** [server/src/index.ts:1151](server/src/index.ts:1151) logs the entire allowedTools list at boot to stdout. Fine, but couple it with explicit "MODE=production, write tools enabled: false" so an ops typo (`HOME_AI_ALLOW_WRITE_TOOLS=True` vs `true`) is loud.
- **S-L2.** Dockerfile healthcheck (`Dockerfile:65-66`) hits `GET /` which serves SPA HTML. Doesn't actually verify backend liveness. Add a `/healthz` JSON endpoint that exercises the DB.
- **S-L3.** No dependency-CVE check in CI. `npm audit` should run on PR. Pinned `bcrypt ^6` is OK; `better-sqlite3 ^12` is current.
- **S-L4.** `extractText` ([index.ts:456](server/src/index.ts:456)) silently ignores tool_use / image / non-text blocks when building the smart-title transcript. Acceptable, but a chat that's all tool calls produces an empty title without explanation in logs.
- **S-L5.** `/api/kg/by-name/:name` ([index.ts:555](server/src/index.ts:555)) — the `:name` URL param is decoded but not bounded. A 10MB URL-encoded name would still be rejected by Hono/node defaults, but worth confirming.
- **S-L6.** `/data` volume in compose is named `home-ai-data` but the README/migration story for moving it across hosts (e.g. when restoring on a new machine) isn't smoke-tested in CI.
- **S-L7.** Missing `AbortSignal` plumbing into the Voyage `fetch` call ([embeddings/voyage.ts](server/src/embeddings/voyage.ts)) — a stuck request stays stuck until Node's default timeout.

---

## Code-quality findings

### Architectural / file-size

- **C-A1.** [server/src/index.ts](server/src/index.ts) is 1155 lines and houses CORS, auth wiring, every API route, smart-titling, helpers, static serving, server boot. Hard to navigate and hard to test. **Split** into `server/src/routes/{chat,sessions,kg,notes,folders,approval,smart-title}.ts` with `index.ts` reduced to wiring + boot. Each new route file ≤ 150 lines.
- **C-A2.** [web/src/App.tsx](web/src/App.tsx) — likely the same shape. Verify and split if so (intent: each top-level surface = its own file under `web/src/views/`).
- **C-A3.** `kg/db.ts` mixes schema, migrations, type defs, query helpers, and import/export. Already big. Extract migrations to `kg/migrations.ts` and import/export to `kg/io.ts`. Schema stays.

### Convention adherence

- **C-C1.** [server/src/index.ts:224](server/src/index.ts:224) does `const m = message as Record<string, unknown> & { type: string };` — a manual cast over the SDK message union. The SDK exports proper types (`SDKMessage`, etc.); switch to discriminated-union narrowing rather than the cast. Same at [index.ts:238-243](server/src/index.ts:238) (manual event shape).
- **C-C2.** Several `.catch(() => null)` patterns around `c.req.json()` swallow JSON parse errors silently. Fine for "invalid JSON" 400s but log a warn so a malformed-client bug is debuggable.
- **C-C3.** [server/src/index.ts:159](server/src/index.ts:159) has `av = a[i]!` non-null assertion. The bounded loop guarantees safety, but per CLAUDE.md "no `!`". Replace with `const av = a[i]; if (av === undefined) continue;` or change loop bounds.

### Correctness / bugs

- **C-B1. `titledSessions` race.** Captured by the failed code-quality agent: in-memory only, never pruned, restart loses dedupe state. Already covered in S-H6 — group with the rate-limit cleanup task.
- **C-B2. Embedding error path may hide outages.** [server/src/embeddings/index.ts](server/src/embeddings/index.ts) and call sites all `console.warn` and continue. After a Voyage outage of any length, retrieval silently degrades to FTS-only with no user-visible signal. **Fix:** track `lastEmbedSuccessAt` and `lastEmbedError`; surface in the empty-state dashboard "stats" widget so the user can spot a stuck Voyage key.
- **C-B3. Concurrent smart-title double-fire** — [index.ts:399-400](server/src/index.ts:399) sets `titledSessions.add(sessionId)` *before* the API call, with a `delete` on failure ([index.ts:432](server/src/index.ts:432)). If two `done` events fire near-simultaneously (parallel turns aren't possible per session today, but defensive…) both pass the `has()` guard before either adds. Tiny window. Fix: use a `Map<string, Promise<void>>` to dedupe in-flight as well.

### Type safety

- **C-T1.** Several JSON parses (`JSON.parse(row.props_json)` in retrieve.ts and db.ts) produce untyped `any`. Wrap with a zod schema at the boundary so downstream code gets a typed `Record<string, JsonValue>`.
- **C-T2.** Import endpoint ([index.ts:1077](server/src/index.ts:1077)) casts `body.nodes as kg.Node[]` without validation — intentional per docs/design.md, but a zod schema with `.passthrough()` would catch shape errors earlier and keep the spirit (no over-strict validation).

### Error handling

- **C-E1.** [server/src/index.ts:317](server/src/index.ts:317) — chat error handler sends the raw `err.message` to the client over SSE. Anthropic SDK errors include detail (model, request_id) — fine for personal use, but in a multi-tenant future this leaks. Worth a redact at the same place we add audit logs.

### Dead code / TODO scan

- No `TODO/FIXME/XXX` found in src (good).
- Several `console.log` statements at boot are intentional. No stray debug logs.

### Test coverage

- **No automated tests in either workspace.** Smoke checks live in task-file `Smoke steps` only. Stack would benefit from:
  - `vitest` for unit tests on `kg/db.ts` (search, neighbors, link, mergeNodes — pure functions, no SDK).
  - Integration tests on auth (login/logout/idle-expiry) against a tmp SQLite DB.
  - A single Playwright happy-path: log in → send chat → see streamed response → see context block → log out.
  - Initial target: 5–10 tests covering the highest-risk paths above.

---

## Capability widening — proposals

Sized for individual follow-up tasks. Listed by leverage, highest first.

### CW1 — File attachments in chat
Drag-and-drop image / PDF into the chat input; send as content blocks via the Anthropic SDK (`type: "image"`, `type: "document"`). Server forwards untouched. UI: image preview chip; PDF page count chip. Estimate 1–2d. **Why high leverage:** unlocks "scan this receipt", "summarize this PDF", "what's in this screenshot" — flagship multi-modal moments the app can't do today.

### CW2 — Voice input (push-to-talk)
Browser `MediaRecorder` → upload chunks to a new `/api/transcribe` endpoint that proxies to a transcription model. Hold-Space to record. Estimate 1d. **Why:** at-home use case (kitchen, gym) where typing is friction.

### CW3 — Cost + token dashboard
Persist `total_cost_usd`, `input_tokens`, `output_tokens`, `cache_create`, `cache_read` per turn (already logged at [index.ts:289](server/src/index.ts:289), just not stored). Render on the dashboard: today / 7d / 30d / per-session. Estimate 0.5d. **Why:** the only visibility today is `tail -f` on the server log.

### CW4 — Mobile PWA install
Add `manifest.json`, service worker, offline shell. App installs on iOS/Android home-screen. Estimate 0.5–1d. **Why:** "personal AI" expects to be one tap away. Most of the work is config + an icon set.

### CW5 — Session search (semantic)
Embed each user/assistant turn at write time (cheap with the existing Voyage adapter); add a search bar above the session list that hits a new `/api/sessions/search?q=…` endpoint. Estimate 1.5d. **Why:** as conversation count grows, "where did we talk about X?" becomes the dominant retrieval pattern.

### CW6 — External MCP connector UI
Agent SDK already supports arbitrary MCP servers — surface a settings page where the user pastes a `mcp.config.json` snippet (or picks from a curated list) and they get registered into `mcpServers`. Estimate 2d. **Why:** unlocks every MCP tool the ecosystem ships (Slack, Linear, Calendar, GitHub, Supabase, etc.) without per-integration code.

### CW7 — Long-lived API tokens for scripting
Separate from session cookies: user can mint a `home_ai_<...>` PAT in settings, scoped to read-only KG / read-write KG / chat. Estimate 1d. **Why:** lets the user curl their own KG from cron jobs, shell scripts, n8n workflows.

### CW8 — Smart-home control via Home Assistant
HA exposes a REST API + WebSocket. Wrap as MCP tools (`mcp__hass__list_entities`, `__call_service`). Single env var for the HA token. Estimate 2–3d. **Why:** delivers on the "home" half of "home-ai" — turn off the lights, query the thermostat, "did the front door lock?".

### CW9 — Push notifications for approval requests
Web push for `approval_request` SSE events; ring a notification on the user's phone when the agent is mid-task and needs a green-light. Estimate 1.5d. **Why:** the approval modal only works while the tab is in focus; agent tasks (e.g. an Obsidian import) become walk-away-able.

### CW10 — Memory consolidation pass (scheduled job)
Periodic background scan that proposes (via the existing approval modal) merges of obvious duplicates, forgets of low-confidence inferred facts older than N days with no reinforcement, and note-rewrite suggestions for stale notes. Estimate 2d. **Why:** the KG accumulates entropy; the approval-modal infrastructure already lets the user gate every change.

### CW11 — Backup automation
Daily cron in the container: `sqlite3 .backup data/kg.sqlite.bak` → encrypt with a user-provided GPG key → push to S3 / GDrive / dropbox. Estimate 1d. **Why:** today's backup story is "remember to copy `data/`". One disk failure = full memory loss.

### CW12 — Native mobile shell (Capacitor)
Bundle the existing SPA inside a Capacitor wrapper for iOS/Android app store presence + native push + biometric login. Estimate 3–5d. **Why:** PWA gets you 80% there; native gets you Touch ID, lock-screen widgets, deep iOS integrations.

---

## Suggested follow-up task split

If the user wants to act on this audit, slice into these task-file batches (each independently shippable):

**Hardening batch 1 — HTTP edge** (one task each, file-disjoint, parallelizable via `/task-batch`):
- `chore-secure-headers` (S-H2)
- `chore-body-limits` (S-H3)
- `chore-rate-limit-routes` (S-H5 + S-H6 + S-M2 — group so the rate-limit infra lands once)
- `chore-trusted-proxies` (S-H4)

**Hardening batch 2 — auth posture:**
- `chore-absolute-session-expiry` (S-M1)
- `chore-host-cookie-prefix` (S-M6)
- `chore-bcrypt-cost-check` (S-M3)
- `chore-audit-log` (S-M7 + C-E1)

**Hardening batch 3 — agent privilege:**
- `chore-agent-fs-sandbox` (S-H1) — the biggest single risk; lands alone.
- `chore-ssrf-blocklist` (S-H1 P2)

**Code quality:**
- `refactor-server-index-split` (C-A1)
- `refactor-web-app-split` (C-A2)
- `refactor-kg-db-split` (C-A3)
- `chore-remove-non-null-assertions` (C-C3)
- `chore-config-validation-zod` (S-M2 — boot-time)
- `chore-vitest-baseline` (test coverage)

**Capability widening (pick by priority):** CW1–CW12 each become their own `m7-…` or `feat-…` task when chosen.
