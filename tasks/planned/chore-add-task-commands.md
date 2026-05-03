# Add 7 new slash commands

**Why:** Locked in during area 1 design — round out the task workflow + add specialized agent invocations.

**What:** Create 7 new files in `.claude/commands/`:

- `task-batch.md` — `/task-batch <N>`: spawn `story-planner` to pick N file-disjoint tasks (cap N at 5; refuse if higher), then move each to `/in-progress` and spawn parallel `story-implementer` runs **each in an isolated worktree** (`isolation: "worktree"` per the Agent tool spec — auto-created and auto-cleaned). Reports each agent's result as it returns. Main thread offers to commit each to `dev-tl` as they finish (commit-as-each-finishes). Failed agents don't abort the batch — others continue.
- `task-status.md` — `/task-status <slug>`: read `tasks/in-progress/<slug>.md`, report `Status` + `Started` + `Notes` sections.
- `task-revert.md` — `/task-revert <slug>`: move `/in-progress` → `/planned` (recovery). Preserves Notes; resets `Status: pending` and `Started: —`.
- `bug.md` — `/bug "<description>"`: spawn `bug-hunter` with the description.
- `refactor.md` — `/refactor "<description>"`: spawn `refactorer` with the description.
- `design-log.md` — `/design-log "<title>"`: append a new dated entry at the top of the Decisions section in `docs/design.md`. Prompts user to fill the body.
- `seed-fact.md` — `/seed-fact <a> <edge> <b>`: append entry to the `FACTS` array in `server/src/seed.ts`.

**Files:** 7 new files in `.claude/commands/`

**Estimate:** 1 hr

**Dependencies:** chore-add-story-planner (for task-batch), chore-add-bug-hunter (for bug), chore-add-refactorer (for refactor), chore-update-task-new-template (for task-status to read the new format)

**Smoke steps:** Each new command appears in the slash-command list (`/`); each does the right thing on a representative input.

---

**Status:** pending
**Started:** —

## Notes
