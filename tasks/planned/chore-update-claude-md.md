# Update CLAUDE.md: convention, agent/command/skill inventory, read-order, git rules

**Why:** Areas 1 + 2 design locked in conventions, new agents/commands/skills, an explicit onboarding read-order, and project-scoped git rules. CLAUDE.md should reflect all of it so a fresh Claude session has the full map without grepping.

**What:** Update `CLAUDE.md`:

- **New `## Read this in order` section at the top** (before "Where context lives"):
  1. This file (`CLAUDE.md`)
  2. `docs/design.md` (newest entries first — recent decisions)
  3. `docs/milestones.md` (M-level status)
  4. `tasks/in-progress/` (anything mid-flight)

- **Naming convention bullets** under the Task workflow section:
  - `m<N>[p<K>]-<kebab>` for milestone work (e.g., `m45-auth-routes`, `m4p3-json-import`)
  - `bug-<kebab>` for bug fixes
  - `refactor-<kebab>` for refactors
  - `chore-<kebab>` for deps / tooling / infra
  - `spike-<kebab>` for research

- **Updated slash-command list** under Task workflow to include all current commands (existing 5 + the 7 new from `chore-add-task-commands` + `/audit-claude-folder` from `chore-add-audit-claude-folder-command`).

- **New `## Subagents` section** listing each agent: name, when to invoke, slash command if any. Cover: `story-implementer`, `story-planner`, `bug-hunter`, `refactorer`, plus a note on built-in `Explore` and `Plan`.

- **New `## Skills` section** listing project-scoped skills and their triggers: `typescript`, `hono`, `react`, `tailwind`, `anthropic-sdk`, `sqlite`. Note that the global `claude-api` skill also auto-loads for SDK code.

- **New `## Git rules` section:**
  - Never work on `main`. Always `dev-tl`. (Enforced by hook in `chore-prevent-main-commits` once area 4 lands; until then, vigilance.)
  - Commit message style: short title, optional body, end with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer
  - One commit per shipped task (by convention; matches the per-story task-file lifecycle)
  - Don't `--amend`; create new commits
  - Don't skip hooks (`--no-verify`) unless explicitly asked
  - Don't force-push to `main` ever

- **Remove `Skills (.claude/skills/)` and `Hooks`** from the "Don't add until needed" list (we're past those gates now — area 2 added 6 skills, area 4 added 2 hooks).

- **New `## Multi-agent coordination` section** (area 5 policy):
  - **Parallel mode:** `/task-batch <N>` fans out N parallel `story-implementer` runs (cap N=5). Each runs in an isolated harness-managed worktree.
  - **Pre-flight:** `story-planner` picks file-disjoint tasks before fan-out so consolidation back to `dev-tl` is mechanical (no merge conflicts).
  - **Defense in depth:** `story-implementer` cross-checks `tasks/in-progress/` for overlap before starting; aborts if it finds any.
  - **Commit ordering:** as each agent finishes, main thread offers to commit its diff to `dev-tl` with the suggested message. No batch deferral by default.
  - **Failure containment:** one agent failing doesn't abort the batch. Failed task lands in `/in-progress` with `Status: blocked`; user fixes or `/task-revert`s it.
  - **Lock model:** the file move (`/planned` → `/in-progress`) is the lock. Nothing else picks up a claimed task.

- **New `## Settings + hooks` section** (area 4 policy):
  - **Files:** `.claude/settings.json` is committed (project-wide policy + hook configs). `.claude/settings.local.json` is gitignored (per-user permission allowlists + env overrides).
  - **Hook scripts:** live in `.claude/scripts/` as Node `.mjs` files. Hook config invokes `node .claude/scripts/<name>.mjs`. Truly cross-platform — Windows + Mac + Linux.
  - **Failure semantics:** `PreToolUse` non-zero exit **blocks** the tool call (this is how `chore-prevent-main-commits` works). `SessionStart` non-zero **logs to stderr but doesn't crash** the session (a missing `chore-stale-task-detection` warning isn't worth bricking the session).
  - **Tool/permission overrides:** none at project level today. Local dev keeps the full tool surface; M4.5 production tool-narrowing happens at the Agent SDK layer in `server/src/index.ts`, not here.

- **New `## Communication conventions` section** (area 6 policy):
  - **Response length**: brief (1-3 sentences) for conversational; structured-but-as-long-as-needed for design discussions; tight bullets for status reports (what changed / verified / next). Don't narrate tool calls — the user already sees them.
  - **Ask vs decide**: ask when irreversible, affects shared state, ambiguous scope, or multiple defensible answers. Decide when reversible, contained, or preference is implied. Single targeted clarifying question when unclear — never a wall of questions.
  - **Tradeoffs**: flag explicitly when 2+ defensible answers exist. Pick + flag scannably when the user has explicitly deferred (per `MEMORY.md` — "defer-low-stakes-design-decisions"). Just proceed when preference is implied or stakes are low.
  - **Push-back**: push back with reason when the user is wrong about something concrete (factual, not preference) — don't capitulate to be agreeable. State preference and defer when it's preference vs preference. Ask before revisiting locked decisions.
  - **File refs**: always use `path/file.ts:42` format for specific code locations (clickable in the harness UI).
  - **Standards**: state assumptions when uncertain (don't fake confidence). Don't repeat what tool calls show. Markdown structure when it helps. No emojis unless asked.

- **New `## Improvement lifecycle` section** (area 3 policy):
  - **Adding** a new agent / command / skill / hook: trigger when (a) you've retyped the same prompt 3+ times, OR (b) a workflow has 3+ steps worth encapsulating, OR (c) a class of error has recurred even once. Below this bar → stay in main thread or docs.
  - **Revising** an existing one: when its contract has been violated 2+ times in real use. Single failures are noise.
  - **Deprecation:** per-milestone audit via `/audit-claude-folder`; surface stale entries (no codebase refs, not modified in 60+ days). Human decides on removal — never auto-delete.
  - **Versioning:** rolling edit; git history is the version log. No semver, no archive folder.
  - **Design log discipline:** append a `docs/design.md` entry for non-trivial `.claude/` changes (new agent, contract revision, deprecation, hook added). Skip trivial (typo, rename, one-line tweak).
  - **Audit cadence:** per-milestone, not time-based. When closing an M-level milestone, run `/audit-claude-folder` and review the generated task.
  - **Cross-pollination with `~/.claude/`:** stay project-only by default. Promote a project skill to global (`~/.claude/skills/`) only if a 2nd project would genuinely use it.

**Files:** `CLAUDE.md`

**Estimate:** 45 min

**Dependencies:** chore-add-story-planner, chore-add-bug-hunter, chore-add-refactorer, chore-add-task-commands, chore-add-skill-typescript, chore-add-skill-hono, chore-add-skill-react, chore-add-skill-tailwind, chore-add-skill-anthropic-sdk, chore-add-skill-sqlite

**Smoke steps:** A fresh Claude session reading only `CLAUDE.md` should be able to (a) know what to read next, (b) find every command, agent, and skill, (c) know the git rules, without needing to grep the codebase.

---

**Status:** pending
**Started:** —

## Notes
