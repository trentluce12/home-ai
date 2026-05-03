# Hook to block `git commit` when HEAD = main

**Why:** "Never work on main, always dev-tl" is a project rule (also in `MEMORY.md` user-scope). Today it's user-vigilance + my care; a harness-enforced hook removes the failure mode entirely.

**What:** PreToolUse hook on `Bash` that:
- Inspects the command text
- If it matches `git commit` (or `git push` to main) AND current branch is `main` (check via `git rev-parse --abbrev-ref HEAD`) — block with a clear message: "Refusing commit on main. Switch to dev-tl: `git checkout dev-tl`"
- Allow on any other branch
- Configured in `.claude/settings.json` under `hooks.PreToolUse`
- Non-zero exit blocks the tool call (PreToolUse failure semantics — this is the point)

Implementation: Node script at `.claude/scripts/block-main-commit.mjs` (cross-platform — works on Windows + Mac + Linux).

**Files:** `.claude/settings.json`, `.claude/scripts/block-main-commit.mjs` (new)

**Estimate:** 1 hr

**Dependencies:** none

**Smoke steps:** Manually `git checkout main`, attempt `git commit -m "test"` via Bash tool; verify hook blocks with a clear message. `git checkout dev-tl`, repeat; verify allowed.

---

**Status:** pending
**Started:** —

## Notes
