---
description: Move a task from tasks/in-progress/ back to tasks/planned/ (recovery)
---

Send an in-progress task back to the planned queue. Used when an agent crashed mid-implementation, when a task got picked up by mistake, or when work needs to pause and resume cleanly later.

Slug: "$ARGUMENTS"

Steps:

1. Read `tasks/in-progress/$ARGUMENTS.md`. If it doesn't exist, run `ls tasks/in-progress/` and stop.
2. **Preserve user-authored fields and Notes**, but reset the agent-managed state:
   - `**Status:**` → `pending`
   - `**Started:**` → `—`
   - `## Notes` — keep all existing notes verbatim. They're a record of what happened on the previous attempt; the next pickup wants that context.

   Use `Edit` to replace just those two lines. Don't touch anything else in the file.
3. Move the file: `mv tasks/in-progress/$ARGUMENTS.md tasks/planned/$ARGUMENTS.md`.
4. Report:
   - The slug being reverted.
   - The previous `Status` and `Started` values (so the user sees what state was wiped).
   - Whether Notes was non-empty (preserved as-is) — if there are notes, summarize what they say in 1 line so the user knows what context the next pickup will see.
   - Confirm the file is now at `tasks/planned/$ARGUMENTS.md`.

Notes:

- Don't delete the file or its history — `/task-revert` is recovery, not abort. If the user wants to truly cancel the task, they can `rm tasks/planned/<slug>.md` manually.
- Don't run typecheck, lint, or any other gates. This is a pure file operation.
- If the file lacks the `---` separator (older format with no agent-managed section), just move it — there's no state to reset. Mention this in the report.
