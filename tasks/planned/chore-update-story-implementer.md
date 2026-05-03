# Update story-implementer: gates, retry caps, Status/Notes management

**Why:** Area 1 design locked in stricter verification gates, retry caps, and per-task `Status` / `Started` / `Notes` management. Existing `.claude/agents/story-implementer.md` doesn't reflect any of this.

**What:** Update `.claude/agents/story-implementer.md`:

- **Pre-implementation overlap check** (defensive — catches manual `/task-start` during a ralph batch): on pickup, read all other `tasks/in-progress/*.md` files. If any has a `**Files:**` entry that overlaps this task's `**Files:**`, abort and report — don't risk stomping on a parallel agent.

- **Verification gates** (after implementation, in order):
  1. `npm run typecheck` → pass
  2. `npm run lint` → zero errors (warnings allowed but reported)
  3. `npm run format:check` → pass; agent runs `npm run format` if it fails
  4. `grep` for new `TODO`/`FIXME`/`XXX`/`console.log`/`debugger` in changed files → flag any new ones (existing OK)
  5. `git diff package.json` → if changed, agent must explicitly call out new deps in report

- **Retry cap**: 3 attempts per gate. After 3 failures, stop and report the persistent error verbatim. No infinite loops.

- **Status management**:
  - On pickup: write `Status: in-progress` and `Started: <ISO timestamp>` to the agent-managed section
  - On success: delete the task file (existing behavior)
  - On failure: write `Status: blocked` + a Notes entry explaining why; leave file in `/in-progress`

- **Notes**: append observations as they happen (mid-task design decisions, files unexpectedly touched, scope creep avoided). Notes survive in the file if the task fails.

- **Failure modes** (explicit):
  - Contradictory task → stop at planning step, report the contradiction, ask for clarification
  - Missing files → report what's missing, don't hallucinate equivalents
  - Smoke fail → suggested commit message includes `DO NOT COMMIT — smoke failed`

- **Honest reporting**: every gate's outcome in the final summary, not just "all good."

**Files:** `.claude/agents/story-implementer.md`

**Estimate:** 45 min

**Dependencies:** chore-lint-format, chore-update-task-new-template

**Smoke steps:** Run on a small task with an intentionally seeded lint error; verify agent retries up to 3x, then stops and reports.

---

**Status:** pending
**Started:** —

## Notes
