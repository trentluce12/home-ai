# Surface stale tasks in /in-progress on session start

**Why:** Failure recovery design (area 1, #3) calls for surfacing tasks in `tasks/in-progress/` older than 1 hour at session start — likely orphans from crashed agents or interrupted sessions.

**What:** SessionStart hook that:
- Scans `tasks/in-progress/` for files
- Parses each file's `Started:` timestamp from the agent-managed section
- If timestamp is missing or older than 1 hour, surfaces a brief warning with slug + age + suggestion to `/task-revert` or resume

**Files:** `.claude/settings.json` (hook config) + `.claude/scripts/check-stale-tasks.mjs` (Node — cross-platform)

**Estimate:** 1 hr

**Dependencies:** chore-update-task-new-template (needs `Started:` field in tasks to parse)

**Smoke steps:** Manually create a stale `tasks/in-progress/test.md` with an old `Started:` timestamp; start a fresh session; verify the warning fires (printed to stderr; non-zero exit must NOT crash the session — SessionStart failure semantics per area 4).

---

**Status:** pending
**Started:** —

## Notes
