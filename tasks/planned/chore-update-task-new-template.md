# Update /task-new template to new format

**Why:** Area 1 design added `Status` / `Started` / `Notes` / `Dependencies` / `Smoke steps` sections. `/task-new` template doesn't include them yet.

**What:** Update `.claude/commands/task-new.md` so the generated template is:

```
# <title>

**Why:** TODO — one-line reason this task exists
**What:** TODO — brief description of the work
**Files:** TBD
**Estimate:** TBD
**Dependencies:** none
**Smoke steps:** TBD

---

**Status:** pending
**Started:** —

## Notes
```

The `---` separates user-authored fields (above) from agent-managed state (below).

**Files:** `.claude/commands/task-new.md`

**Estimate:** 15 min

**Dependencies:** none

**Smoke steps:** Run `/task-new test-task`; verify the generated file has all sections in the right order.

---

**Status:** pending
**Started:** —

## Notes
