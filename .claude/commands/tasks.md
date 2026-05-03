---
description: List current tasks (planned + in-progress)
---

Show the kanban view: list `tasks/in-progress/` (current WIP) and `tasks/planned/` (queue, split into Ready vs Blocked by dependency state).

Steps:

1. Run `ls tasks/in-progress/` and `ls tasks/planned/`. Strip the `.md` suffix to get slugs.
2. Build the **present-slug set** = union of slugs from both directories. A dep is "unmet" iff it's in this set; otherwise it's already shipped (or never existed) and counts as met.
3. For each planned file, extract its dependency slugs:
   - Read the file. Look for a line starting with `**Dependencies:**`.
   - If present: take everything after `**Dependencies:**`, split on commas, strip whitespace and any trailing parenthetical (e.g. `chore-add-bug-hunter (for bug)` → `chore-add-bug-hunter`). The literal token `none` means no deps.
   - If absent: scan the file for any line containing `Depends on` (case-insensitive) and extract backtick-wrapped slugs from that line (e.g. `Depends on \`m45-auth-sessions-table\``). This catches the older task format. If no such line exists, treat as no deps.
4. Classify each planned task:
   - **Ready** — every dep is either `none`, missing, or absent from the present-slug set.
   - **Blocked** — at least one dep is in the present-slug set. Record the unmet deps for inline display.
5. Render the output as three sections, each with a count. Empty sections say `(empty)`. Sort each section alphabetically (milestone prefix gives implicit grouping):

   ```
   ## In progress (N)
   - <slug>
   - <slug>

   ## Ready (N)
   - <slug>
   - <slug>

   ## Blocked (N)
   - <slug> ← <unmet-dep-1>, <unmet-dep-2>
   - <slug> ← <unmet-dep>
   ```

6. After the lists, add a one-line note if relevant: e.g. `Tip: tasks with no deps but project-level "should come last" intent (e.g. m45-docker, m45-deploy-readme) show as Ready — milestone-internal ordering is human judgment.`

Notes:

- Only show **unmet** deps in the `←` suffix. A dep that's already shipped (absent from present-slug set) must not appear, even if it's listed in the file's `**Dependencies:**` field.
- Don't recurse — a transitive blocker isn't surfaced. If A blocks B blocks C, C just shows `← B`.
- Don't try to extract "soft" dep references from prose (e.g. "see m45-deploy-readme") — only the explicit `**Dependencies:**` field or a `Depends on \`<slug>\`` line counts.
