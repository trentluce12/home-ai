---
description: Append a new dated entry at the top of the Decisions section in docs/design.md
---

Scaffold a new design-log entry. The user fills in the body; this command handles the placement and date stamp so the format stays consistent.

Title: "$ARGUMENTS"

Steps:

1. **Validate input.** If `$ARGUMENTS` is empty, ask the user for a 2–6 word title and stop. The title should be a noun phrase that names the decision (e.g., `M5 notes layer — embedding strategy`, not `decided what to do about embeddings`).
2. **Read `docs/design.md`** to find the `## Decisions` heading. Confirm it exists. The format under it is:

   ```
   ## Decisions

   Newest first. Append entries; don't edit history.

   ### YYYY-MM-DD · <title>

   <body>

   ### YYYY-MM-DD · <previous title>
   ...
   ```

   New entries go **immediately under** the "Newest first..." line, before the most recent existing entry.
3. **Compute today's date** in `YYYY-MM-DD` format (use the harness-provided current date — `date +%Y-%m-%d` from Bash, or whatever the environment exposes). Don't fabricate dates.
4. **Use `Edit` to insert** a new entry. The pattern: find the line `Newest first. Append entries; don't edit history.` and replace it with itself + a blank line + the new entry header + a body placeholder. The new entry looks like:

   ```
   ### <today> · $ARGUMENTS

   TODO — fill in: context, decision, alternatives considered, what's in/out of scope.
   ```

   The body placeholder is intentional — the user fills it in. Don't write the decision text yourself; you don't have the context.
5. **Report.** Tell the user the entry was added at `docs/design.md` under `## Decisions`, with today's date and the title. Suggest they fill in the body now or via their next edit.

Notes:

- Don't edit any existing entries. The log is append-only by convention; rewriting history defeats the purpose.
- If `## Decisions` doesn't exist (shouldn't happen, but defensively): stop and report — don't create the section silently. Surface the structural issue to the user.
- The `·` separator between date and title is a literal middle-dot character (U+00B7), matching the existing style. If your editor has trouble with it, copy from an existing entry.
- This command is for non-trivial decisions: tradeoffs considered, alternatives ruled out, constraints discovered. Routine changes go in commit messages, not the design log.
