# home-ai — project notes

A personal "home AI" — chat UI on top of the Anthropic API. Knowledge graph context comes in M1.

## Read this in order

A fresh Claude session should orient by reading these top-down:

1. **This file** (`CLAUDE.md`) — conventions, stack, the map of agents/commands/skills/hooks
2. **`docs/design.md`** — newest entries first; recent decisions land at the top of the Decisions section
3. **`docs/milestones.md`** — M-level status (what's shipped, what's next)
4. **`tasks/in-progress/`** — anything mid-flight; if there's an open file, that's the active work

Once oriented, drop into the specific files the current task touches. Skills auto-load when their triggers match — don't pre-read them.

## Where context lives

- **`docs/design.md`** — architecture overview + decisions log
- **`docs/milestones.md`** — M-level status: what's shipped, what's next
- **`tasks/planned/`, `tasks/in-progress/`** — per-story markdown files for pending work (Why / What / Files / Estimate / Status / Started / Notes / Dependencies / Smoke steps)
- **This file** — coding conventions and stack at a glance

When making non-trivial decisions, append an entry to `docs/design.md`. When closing out a milestone phase, update `docs/milestones.md`. Per-story state changes happen via the task workflow below — `docs/` reflects shipped reality, `tasks/` reflects pending work.

## Task workflow

Lifecycle: write a task in `tasks/planned/`, move to `tasks/in-progress/` when picking it up, delete on completion. Slash commands handle the file ops:

- `/task-new <title>` — scaffold a new task in `tasks/planned/`
- `/task-start <slug>` — move planned → in-progress and spawn the `story-implementer` subagent (implements, runs typecheck + lint + format gates, smoke-tests if headless, deletes the task file, reports back). Refuses to claim a task whose `Dependencies:` are still pending.
- `/task-batch <N>` — pick N file-disjoint planned tasks via `story-planner` and run them in parallel via `story-implementer` worktrees (cap N=5)
- `/task-status <slug>` — show Status / Started / Notes for an in-progress task
- `/task-revert <slug>` — move a task from `tasks/in-progress/` back to `tasks/planned/` (recovery if an agent crashed mid-flight)
- `/task-done <slug>` — delete the in-progress file + update `docs/milestones.md` / `docs/design.md` if the task closed a phase or made a non-trivial decision
- `/tasks` — list current state (planned + in-progress)
- `/bug "<symptom>"` — spawn the `bug-hunter` subagent to investigate (read-only by default; pass "and fix it" to authorize edits)
- `/refactor "<change>"` — spawn the `refactorer` subagent for a mechanical multi-file change with behavior-preservation guarantee
- `/design-log` — append a new dated entry at the top of the Decisions section in `docs/design.md`
- `/seed-fact` — append a new fact to the `FACTS` array in `server/src/seed.ts`
- `/check` — typecheck both workspaces
- `/audit-claude-folder` — per-milestone consistency + housekeeping check on `.claude/`; produces a fresh `chore-audit-claude-folder-<date>.md` task with findings

Done = deleted: git history + `docs/` keep the record, no `tasks/done/` graveyard.

### Task naming convention

- `m<N>[p<K>]-<kebab>` — milestone work (e.g., `m45-auth-routes`, `m4p3-json-import`)
- `bug-<kebab>` — bug fixes
- `refactor-<kebab>` — refactors
- `chore-<kebab>` — deps / tooling / infra
- `spike-<kebab>` — research

## Stack

- **Frontend** — Vite + React + TypeScript + Tailwind (in `web/`)
- **Backend** — Hono + `@anthropic-ai/sdk` with SSE streaming (in `server/`)
- **Workspace** — npm workspaces; `npm run dev` runs both via `concurrently`

## Conventions

- Use `claude-opus-4-7` as the model — don't downgrade for cost, that's the user's call
- Stream responses (`messages.stream()` + `.finalMessage()`); never wrap stream events in `new Promise()`
- Use SDK types (`Anthropic.MessageParam`, `Anthropic.Message`, etc.) — don't redefine equivalents
- Use typed exceptions (`Anthropic.RateLimitError`, etc.) — never string-match error messages
- Tailwind-first styling, dark mode by default

## Subagents

In `.claude/agents/`. Spawn the right one for the right kind of work — they run with isolated context windows so the main thread stays clean.

- **`story-implementer`** (opus) — implement a single in-progress task end-to-end. Pre-flight overlap check, typecheck + lint + format + grep-for-new-TODO/console.log/debugger gates with a 3-attempt retry cap, manages Status/Started/Notes on the task file, deletes the file on success or marks blocked on failure. Does NOT commit. Invoked via `/task-start` and `/task-batch`.
- **`story-planner`** (sonnet, read-only) — pick N file-disjoint planned tasks for parallel execution. Honors `Dependencies:` (skips tasks blocked by deps still in `/planned` or `/in-progress`) and avoids file conflicts with anything already `/in-progress`. Reports chosen slugs + rationale; the main thread or `/task-batch` performs the file moves. Invoked via `/task-batch`.
- **`bug-hunter`** (opus) — investigate a bug end-to-end (reproduce → narrow → identify root cause → propose fix). Read-mostly by default; only edits when the input explicitly says "and fix it". Honest about uncertainty: lists alternatives with confidence levels when multiple causes are plausible. Invoked via `/bug`.
- **`refactorer`** (opus) — mechanical multi-file refactor (rename, signature change, extract module, move type) with a hard behavior-preservation guarantee. Stops and reports if an unavoidable behavior change is needed — never silently introduces semantic changes. Invoked via `/refactor`.

The harness also has built-in `Explore` (parallel codebase exploration) and `Plan` (write-up planning) subagents — use them ad-hoc when the work fits, no slash command needed.

## Skills

In `.claude/skills/`. Auto-load when their triggers match — don't pre-read or manually invoke.

- **`typescript`** — SDK types over hand-rolled equivalents, typed exceptions over message-matching, no `any`, no `!` non-null assertions, type-only imports for types. Triggers on any `.ts`/`.tsx` under `server/src/**` or `web/src/**`.
- **`hono`** — route style, middleware order, SSE streaming, error handling, cookie helpers. Triggers on `server/src/**/*.ts` or any file importing `hono`.
- **`react`** — function components, hook discipline, derived-state-in-render. Triggers on `.tsx` files in `web/src/`.
- **`tailwind`** — dark-mode-first, `prose-invert` for markdown, Geist as the global font, inline utility classes over extracted styles. Triggers on `.tsx` files under `web/src/**`.
- **`anthropic-sdk`** — project layer on top of the global `claude-api` skill. Model choice, streaming pattern, typed errors, no-Promise-wrapping. Triggers on imports of `@anthropic-ai/sdk` or `@anthropic-ai/claude-agent-sdk`.
- **`sqlite`** — synchronous API, transactions, prepared statements, FK cascades, WAL mode, FTS5 sync. Triggers on imports of `better-sqlite3` or any file under `server/src/kg/**/*.ts`.

The global `claude-api` skill (in `~/.claude/skills/`) also auto-loads for any code touching the Anthropic SDK — it handles model migration, prompt caching, adaptive thinking. The project-scoped `anthropic-sdk` skill layers on top of it with home-ai-specific decisions; both are expected to load together for SDK code.

## Git rules

- **Never work on `main`. Always on `dev-tl`.** (Enforced by the `chore-prevent-main-commits` PreToolUse hook once area 4 lands; until then, vigilance.)
- Commit message style: short title, optional body, end with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer.
- One commit per shipped task by convention — matches the per-story task-file lifecycle.
- Don't `--amend`; create new commits. If a hook fails, fix the underlying issue and create a NEW commit (the failed `--amend` would rewrite the previous commit, not the failed one).
- Don't skip hooks (`--no-verify`, `--no-gpg-sign`) unless the user explicitly asks.
- Don't force-push to `main` ever. Force-push to feature branches only with explicit user OK.

## Multi-agent coordination

When `/task-batch <N>` fans out parallel `story-implementer` runs (cap N=5), the orchestration model is:

- **Parallel mode.** Each agent runs in an isolated harness-managed worktree. No shared mutable state across agents.
- **Pre-flight planning.** `story-planner` picks file-disjoint tasks before fan-out so consolidation back to `dev-tl` is mechanical (no merge conflicts). Tasks blocked by `Dependencies:` are skipped, not picked.
- **Defense in depth.** `story-implementer` cross-checks `tasks/in-progress/` for `**Files:**` overlap before starting; aborts if it finds any (catches manual `/task-start` interleaved with a batch).
- **Commit ordering.** As each agent finishes, main thread offers to commit its diff to `dev-tl` with the suggested message. No batch deferral by default.
- **Failure containment.** One agent failing doesn't abort the batch. Failed task lands in `/in-progress` with `Status: blocked`; user fixes by hand or `/task-revert`s it back to `/planned`.
- **Lock model.** The file move (`/planned` → `/in-progress`) is the lock. Nothing else picks up a claimed task.

## Settings + hooks

- **Files.** `.claude/settings.json` is committed (project-wide policy + hook configs). `.claude/settings.local.json` is gitignored (per-user permission allowlists + env overrides).
- **Hook scripts.** Live in `.claude/scripts/` as Node `.mjs` files. Hook config invokes `node .claude/scripts/<name>.mjs`. Truly cross-platform — Windows + Mac + Linux without bash-vs-PowerShell drama.
- **Failure semantics.** `PreToolUse` non-zero exit **blocks** the tool call (this is how `chore-prevent-main-commits` works). `SessionStart` non-zero **logs to stderr but doesn't crash** the session — a missing `chore-stale-task-detection` warning isn't worth bricking the session.
- **Tool/permission overrides.** None at project level today. Local dev keeps the full tool surface; M4.5 production tool-narrowing happens at the Agent SDK layer in `server/src/index.ts`, not here.

## Communication conventions

- **Response length.** Brief (1–3 sentences) for conversational; structured-but-as-long-as-needed for design discussions; tight bullets for status reports (what changed / verified / next). Don't narrate tool calls — the user already sees them.
- **Ask vs decide.** Ask when irreversible, affects shared state, ambiguous scope, or multiple defensible answers. Decide when reversible, contained, or preference is implied. Single targeted clarifying question when unclear — never a wall of questions.
- **Tradeoffs.** Flag explicitly when 2+ defensible answers exist. Pick + flag scannably when the user has explicitly deferred (per the `MEMORY.md` "defer-low-stakes-design-decisions" entry). Just proceed when preference is implied or stakes are low.
- **Push-back.** Push back with reason when the user is wrong about something concrete (factual, not preference) — don't capitulate to be agreeable. State preference and defer when it's preference vs preference. Ask before revisiting locked decisions.
- **File refs.** Always use `path/file.ts:42` format for specific code locations (clickable in the harness UI).
- **Standards.** State assumptions when uncertain (don't fake confidence). Don't repeat what tool calls show. Markdown structure when it helps. No emojis unless asked.

## Improvement lifecycle

How the `.claude/` folder grows and shrinks over time.

- **Adding** a new agent / command / skill / hook: trigger when (a) you've retyped the same prompt 3+ times, OR (b) a workflow has 3+ steps worth encapsulating, OR (c) a class of error has recurred even once. Below this bar → stay in main thread or docs.
- **Revising** an existing one: when its contract has been violated 2+ times in real use. Single failures are noise.
- **Deprecation.** Per-milestone audit via `/audit-claude-folder`; surface stale entries (no codebase refs, not modified in 60+ days). Human decides on removal — never auto-delete.
- **Versioning.** Rolling edit; git history is the version log. No semver, no archive folder.
- **Design log discipline.** Append a `docs/design.md` entry for non-trivial `.claude/` changes (new agent, contract revision, deprecation, hook added). Skip trivial (typo, rename, one-line tweak).
- **Audit cadence.** Per-milestone, not time-based. When closing an M-level milestone, run `/audit-claude-folder` and review the generated task.
- **Cross-pollination with `~/.claude/`.** Stay project-only by default. Promote a project skill to global (`~/.claude/skills/`) only if a 2nd project would genuinely use it.

## Useful commands

- `npm run dev` — start both servers (wipes the KG and reseeds it from `server/src/seed.ts` first)
- `npm run typecheck` — typecheck both workspaces
- `npm run lint` / `npm run lint:fix` — ESLint across both workspaces (flat config in `eslint.config.mjs`)
- `npm run format` / `npm run format:check` — Prettier (`.prettierrc.json`); markdown is intentionally ignored to keep prose untouched
- `/check` — same as typecheck, via slash command

## Seed data

`server/src/seed.ts` is the source of truth for what the KG knows at dev startup. It runs as part of `predev`, so each `npm run dev` resets the database to exactly what's in the `FACTS` array. Append entries as the project gains knowledge worth pinning. Don't rely on facts learned in prior chat sessions surviving a dev restart.

## Don't add until needed

- Prompt caching, adaptive thinking, conversation persistence

These get added when there's real friction to remove, not preemptively.
