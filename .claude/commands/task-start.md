---
description: Move a task from tasks/planned/ to tasks/in-progress/ and spawn the story-implementer subagent
---

Start work on a task: verify deps, move planned → in-progress, then hand off to the `story-implementer` subagent.

Slug: "$ARGUMENTS"

Steps:

1. **Read the source file first** (don't move yet): `tasks/planned/$ARGUMENTS.md`. If it doesn't exist, run `ls tasks/planned/` so the user can see what's available, then stop.
2. **Parse the `**Dependencies:**` line** from the file. Format examples:
   - `**Dependencies:** none` → no deps, skip to step 4
   - `**Dependencies:** slug-one` → single dep
   - `**Dependencies:** slug-one, slug-two` → comma-separated list
   - `**Dependencies:** slug-one (some explanation)` → strip the parenthetical, the dep is `slug-one`
   - Field absent entirely → treat as `none` (older task files may predate the field)
3. **Check each listed slug.** For every dep `<slug>`, check whether `tasks/planned/<slug>.md` OR `tasks/in-progress/<slug>.md` exists. If any do, **abort the move**:
   - Report the slug being started, the unmet deps (with their current location: planned vs in-progress), and suggest running `/task-start` on each unmet dep first (or completing the in-progress ones).
   - Do not invoke the subagent. Stop.
4. **Deps clean** (or none listed): run `mv tasks/planned/$ARGUMENTS.md tasks/in-progress/$ARGUMENTS.md`.
5. Spawn the `story-implementer` subagent. Prompt: `Implement task slug \`$ARGUMENTS\`. The task file is at \`tasks/in-progress/$ARGUMENTS.md\`. Follow your contract.`
6. After the subagent returns, summarize for the user:
   - Files changed
   - `npm run typecheck` status
   - Smoke test outcome (or what needs manual verification)
   - Suggested commit message
7. Ask whether to commit on `dev-tl` with the suggested message (or a tweaked version).
