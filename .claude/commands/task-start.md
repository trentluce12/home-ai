---
description: Move a task from tasks/planned/ to tasks/in-progress/ and spawn the story-implementer subagent
---

Start work on a task: move planned → in-progress, then hand off to the `story-implementer` subagent.

Slug: "$ARGUMENTS"

Steps:
1. Run: `mv tasks/planned/$ARGUMENTS.md tasks/in-progress/$ARGUMENTS.md`
2. If the source file doesn't exist, run `ls tasks/planned/` so the user can see what's available, then stop.
3. Spawn the `story-implementer` subagent. Prompt: `Implement task slug \`$ARGUMENTS\`. The task file is at \`tasks/in-progress/$ARGUMENTS.md\`. Follow your contract.`
4. After the subagent returns, summarize for the user:
   - Files changed
   - `npm run typecheck` status
   - Smoke test outcome (or what needs manual verification)
   - Suggested commit message
5. Ask whether to commit on `dev-tl` with the suggested message (or a tweaked version).
