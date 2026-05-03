# /task-start dependency check

**Why:** Tasks now carry a `Dependencies:` field. `/task-start` should refuse to start a task whose deps are still pending — otherwise the agent will fail at runtime when the dep'd-on infrastructure isn't there.

**What:** Update `.claude/commands/task-start.md`:
- Read the task file BEFORE moving (currently moves first)
- Parse the `**Dependencies:**` field
- For each listed slug, check if it exists in `tasks/planned/` or `tasks/in-progress/`
- If any do: abort the move, report which deps are unmet, suggest starting them first
- If clean: proceed with the existing flow (move + spawn `story-implementer`)

**Files:** `.claude/commands/task-start.md`

**Estimate:** 20 min

**Dependencies:** chore-update-task-new-template (need the field to exist in tasks)

**Smoke steps:** `/task-start` on a task with an unmet dep refuses; on a task with no deps proceeds normally.

---

**Status:** pending
**Started:** —

## Notes
