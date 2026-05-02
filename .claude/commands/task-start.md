---
description: Move a task from tasks/planned/ to tasks/in-progress/
---

Start work on a task by moving it from planned to in-progress.

Slug: "$ARGUMENTS"

Steps:
1. Run: `mv tasks/planned/$ARGUMENTS.md tasks/in-progress/$ARGUMENTS.md`
2. If the source file doesn't exist, run `ls tasks/planned/` so the user can see what's available, then stop.
3. Read the moved file and report the title + Why so the user knows what was just picked up.
