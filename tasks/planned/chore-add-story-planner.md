# Add story-planner subagent

**Why:** Enables the ralph loop — `/task-batch <N>` needs an agent that picks N file-disjoint tasks from `tasks/planned/` for parallel execution by `story-implementer` runs.

**What:** Create `.claude/agents/story-planner.md` with contract:
- Read all files in `tasks/planned/`
- Build a file-touch graph from each task's `**Files:**` field
- Pick N tasks that are mutually file-disjoint (greedy: by Estimate or task-file order)
- Honor `**Dependencies:**` field — skip tasks whose deps are still in `/planned` or `/in-progress`
- Report: chosen slugs + rationale, skipped tasks + reason
- Read-only: does NOT move files; main thread or `/task-batch` does the moves

Tools: `Read`, `Glob`, `Grep`, `Bash` (for `ls`). No `Write`/`Edit`.
Model: `sonnet` (selection logic, not code generation — fast + cheap).

**Files:** `.claude/agents/story-planner.md` (new)

**Estimate:** 45 min

**Dependencies:** none

**Smoke steps:** Invoke directly with N=3 against current `tasks/planned/`; verify chosen tasks have no overlapping `**Files:**` entries and that no dep-blocked task gets picked.

---

**Status:** pending
**Started:** —

## Notes
