---
description: Create a new task in tasks/planned/ from a title
---

Create a new task file in `tasks/planned/`.

Title: "$ARGUMENTS"

Steps:
1. Slugify the title: lowercase, replace spaces with hyphens, strip non-alphanumeric (keep hyphens). Example: "Add session export" → `add-session-export`. If a milestone prefix is obvious from context (e.g. M4.5 work → `m45-`), include it.
2. Use Write to create `tasks/planned/<slug>.md`. The file should contain (substituting `<title>` with the original title):

   ```
   # <title>

   **Why:** TODO — one-line reason this task exists

   **What:** TODO — brief description of the work; reference relevant design log entry if applicable

   **Files:** TBD

   **Estimate:** TBD
   ```

3. Report the created path.
