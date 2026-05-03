---
description: Spawn the bug-hunter subagent to investigate (and optionally fix) a bug
---

Hand off a bug investigation to the `bug-hunter` subagent.

Description: "$ARGUMENTS"

Steps:

1. **Sanity-check the input.** If `$ARGUMENTS` is empty or trivially short ("the app is broken", "fix it"), don't spawn the agent — ask one targeted clarifying question (what's the symptom, what's the repro, what file/route is involved) and stop.
2. **Note the fix authorization.** The `bug-hunter` contract treats the literal phrases `and fix it`, `go ahead and fix`, `patch it` as explicit fix authorization. Anything short of that is investigate-only. Pass the description through verbatim — don't paraphrase, the exact phrasing controls the agent's behavior.
3. **Spawn the `bug-hunter` subagent.** Prompt: `Investigate the following bug and report root cause + proposed fix. Description: "$ARGUMENTS". Follow your contract.`
4. **After the subagent returns, surface the report to the user.** Highlight:
   - Outcome (root cause identified / multiple plausible / could not reproduce / vague).
   - Confidence level on the root cause.
   - Whether a fix was applied (fix-mode) or just proposed (investigate-only).
   - Any flags (recent commit suspected, in-progress task overlap, etc.).
5. **Ask whether to commit** if a fix was applied. Otherwise ask whether to spin up a task file (`/task-new`) for the proposed fix.

Notes:

- This command is a thin wrapper. The agent contract owns the heavy lifting. Don't repeat its rules here.
- The `bug-hunter` doesn't write to `tasks/`. If the bug investigation should become a tracked task, that's a follow-up step the user takes.
- Don't switch branches before spawning. `bug-hunter` works on whatever's checked out (should be `dev-tl`).
