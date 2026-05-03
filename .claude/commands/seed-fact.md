---
description: Append a new fact to the FACTS array in server/src/seed.ts
---

Append a knowledge-graph fact to `server/src/seed.ts`. The seed file is the source of truth for what home-ai knows at dev startup; `npm run dev` resets the KG to exactly the `FACTS` array each time.

Arguments: "$ARGUMENTS" — expected format: `<a> <edge> <b>` (three tokens separated by spaces).

Steps:

1. **Parse the arguments.** Split `$ARGUMENTS` on whitespace. Expect exactly three tokens:
   - `<a>` — the source node name (e.g., `user`, `Snickers`, `home-ai`).
   - `<edge>` — the edge type in SCREAMING_SNAKE_CASE (e.g., `OWNS`, `PREFERS`, `WORKS_AT`, `RELATES_TO`).
   - `<b>` — the target node name.

   If quoted multi-word names are needed (e.g., `"Tailwind CSS"`), respect the quoting.

   If the input doesn't parse cleanly into three tokens, ask the user to re-enter in the `<a> <edge> <b>` format and stop. Don't guess.
2. **Infer node types.** This is the hardest part — `seed.ts` requires `type` for both nodes (one of `Person`, `Pet`, `Project`, `Topic`, `Organization`, `Place`, `Preference`, etc., based on existing entries in `seed.ts`). Strategy:
   - Read `server/src/seed.ts` and look at existing facts. If `<a>` or `<b>` already appears in the array, reuse its declared type.
   - If a node is new and the user didn't specify, infer from the edge:
     - `OWNS` → typically `Person` owns `Pet` / `Project` / `Place`.
     - `WORKS_AT` / `LIVES_IN` → `Person` → `Organization` / `Place`.
     - `PREFERS` → `Person` → `Topic` / `Preference`.
     - `DEPENDS_ON` / `RELATES_TO` → `Project` / `Topic` → `Topic` / `Organization`.
   - When in doubt, ask the user one targeted question (e.g., `What type is "<name>"? Person / Pet / Project / Topic / Organization / Place / Preference?`) rather than guess wrong. A wrong type is worse than asking — the AI treats the seed as ground truth.
3. **Check for duplicates.** Read `seed.ts` and search the `FACTS` array for an existing entry where `a.nameOrId == <a> && b.nameOrId == <b> && edgeType == <edge>` (after type inference, also verify the types match). If a duplicate exists, report it and stop — don't append a redundant entry.
4. **Append the entry.** Use `Edit` to insert the new entry into the `FACTS` array. Place it in the most relevant section (the file uses `// ─── <section> ───` comment dividers — pick one, or create a new `// ─── Personal facts ───` section if none fits). The entry format:

   ```ts
   {
     a: { nameOrId: "<a>", type: "<TypeA>" },
     b: { nameOrId: "<b>", type: "<TypeB>" },
     edgeType: "<EDGE>",
   },
   ```

   Match the indentation and trailing-comma style of surrounding entries.
5. **Verify.** Run `npm run typecheck` to confirm the syntax is valid TypeScript and the `SeedFact` shape is satisfied. If it fails, report and let the user decide — don't try multiple fixes.
6. **Report.**
   - The fact appended (`<a>` `<edge>` `<b>`, with inferred types).
   - The section it landed in.
   - Typecheck result.
   - Reminder that the new fact is live on the next `npm run dev` (which runs `predev` → `seed.ts`).
   - If the user seeded something that should also be a permanent project fact (e.g., a tech stack addition), suggest they consider whether `CLAUDE.md` or `docs/design.md` also wants the update — but don't make those edits automatically.

Notes:

- This command edits one file (`server/src/seed.ts`). No commits.
- Don't reorder or modify existing entries. Append-only.
- The seed wipe + reseed runs every `npm run dev` — there's no migration concern. Adding facts is cheap and reversible.
- If the user wants to add many facts at once, suggest batching them in a single edit pass rather than calling `/seed-fact` repeatedly.
