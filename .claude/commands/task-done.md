---
description: Finish a task — delete the file and update docs as needed
---

Close out a task: delete the file and check whether docs need updating.

Slug: "$ARGUMENTS"

Steps:
1. Read `tasks/in-progress/$ARGUMENTS.md` first so you know what shipped.
2. Delete it: `rm tasks/in-progress/$ARGUMENTS.md`
3. Decide whether docs need updating:
   - **`docs/milestones.md`** — Did this close out a milestone phase, or change its status from "planned" to "in progress" / "shipped"? If yes, update the relevant section.
   - **`docs/design.md`** — Did this involve a non-trivial design decision (a tradeoff considered, an approach picked over alternatives, a constraint discovered)? If yes, append a dated entry. Format: `### YYYY-MM-DD · short title` at the top of the Decisions section, newest first.
4. Report what was deleted and any doc updates made.
