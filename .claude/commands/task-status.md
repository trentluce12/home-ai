---
description: Show Status / Started / Notes for an in-progress task
---

Read the agent-managed state of an in-progress task and report it.

Slug: "$ARGUMENTS"

Steps:

1. Read `tasks/in-progress/$ARGUMENTS.md`. If it doesn't exist, run `ls tasks/in-progress/` so the user can see what's available, then stop.
2. Parse the agent-managed section (everything after the `---` separator). Extract:
   - `**Status:**` — `pending` / `in-progress` / `blocked` (or another value if present)
   - `**Started:**` — `—` or an ISO 8601 timestamp
   - `## Notes` — the bullet list under the Notes heading (may be empty)

   If the file lacks the `---` separator entirely (older format), report `no agent-managed section yet — task hasn't been picked up`.
3. Render the report:

   ```
   ## $ARGUMENTS

   **Status:** <value>
   **Started:** <value>

   ### Notes
   - <note 1>
   - <note 2>
   (or "(none)" if empty)
   ```

4. If `Status` is `blocked`, surface that prominently — the user usually wants to know why and what unblocks it. Suggest `/task-revert <slug>` if the user wants to send it back to `/planned/`.
5. If `Status` is `in-progress` and `Started` is more than 1 hour old, flag it — the agent may have crashed and the task is orphaned. Suggest `/task-revert <slug>` or manual investigation.

Notes:

- Read-only. Do not edit the task file.
- Don't summarize the user-authored fields (Why / What / Files / Estimate / Dependencies / Smoke steps) — the user already wrote those. Just surface the agent-managed state.
