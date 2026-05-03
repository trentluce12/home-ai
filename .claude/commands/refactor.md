---
description: Spawn the refactorer subagent to perform a mechanical multi-file refactor
---

Hand off a mechanical refactor (rename, signature change, module extraction, type move) to the `refactorer` subagent.

Description: "$ARGUMENTS"

Steps:

1. **Sanity-check the input.** If `$ARGUMENTS` is empty or describes a redesign rather than a mechanical change ("clean up the auth code", "make this nicer"), don't spawn the agent — refactors are surgical and need a specific transformation. Ask one targeted clarifying question (what's the source identifier/file, what's the target, what's the scope) and stop.
2. **Pre-spawn overlap check.** Run `ls tasks/in-progress/` and skim each file's `**Files:**` line. If any in-progress task touches files the refactor is likely to hit (best-effort guess based on the description), surface that to the user **before** spawning. Refactoring files another in-flight task is editing is the worst kind of merge conflict — let the user decide whether to defer. The agent will also re-check, but this is a friendlier early warning.
3. **Spawn the `refactorer` subagent.** Prompt: `Perform the following refactor and report. Description: "$ARGUMENTS". Behavior preservation is the contract — stop and report if the change can't be made mechanically. Follow your contract.`
4. **After the subagent returns, surface the report to the user.** Highlight:
   - Outcome (`refactor applied — N sites updated` / `stopped — behavior change detected` / `stopped — file overlap` / `stopped — typecheck fails`).
   - Sites updated count.
   - Typecheck result.
   - Behavior preservation line — explicit confirmation or the reason for stopping.
   - Adjacent issues spotted (NOT fixed) — these usually deserve a follow-up `/task-new` if real.
5. **Ask whether to commit** if the refactor was applied. The agent provides a suggested commit message — pass it through unless the user wants to tweak.

Notes:

- This command is a thin wrapper. The agent contract owns the heavy lifting. Don't repeat its rules here.
- If the refactor is risky (signature change crossing the server/web boundary, rename of an exported public API), consider whether it should be its own task file (`/task-new`) so there's a record. For local renames, ad-hoc invocation is fine.
- Don't switch branches before spawning. `refactorer` works on whatever's checked out (should be `dev-tl`).
