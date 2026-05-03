---
description: Reference card for the home-ai Obsidian-vault import flow (runs in the home-ai chat agent, not in Claude Code)
---

The Obsidian-vault import is a runtime workflow handled by the **home-ai chat agent** — it walks the vault with `Read` + `Glob` and records facts via `mcp__kg__record_user_fact`. This Claude Code command does NOT do the import itself; it just surfaces how to invoke the flow.

Vault path: "$ARGUMENTS"

Steps:

1. **If `$ARGUMENTS` is empty**, ask the user for the absolute path to the Obsidian vault and stop. Don't guess a path.
2. **Confirm the path exists** via `Glob` on `<path>/**/*.md` (head_limit ~5) just to sanity-check the vault is non-empty. If it returns zero matches, tell the user the path looks empty / wrong and stop — don't continue with an unverifiable target.
3. **Surface the runtime workflow.** The actual import runs inside the home-ai chat agent (which has `record_user_fact`). Tell the user to:
   - Open the home-ai web UI (`npm run dev` if not running, then http://localhost:5173).
   - In the chat input, type:
     ```
     /import-obsidian <path>
     ```
     The home-ai agent's system prompt is wired (see `server/src/index.ts` — the OBSIDIAN VAULT IMPORT section) to recognize this and run the bulk-extraction flow.
   - The agent will batch-report progress as it walks the notes (~10 at a time) and give a final tally with anything ambiguous it skipped.
4. **Idempotency note for the user.** The flow is designed to be re-runnable — node dedupe is automatic via `link()`'s `findOrCreateNode`, and the agent is instructed to check `mcp__kg__neighbors` before recording the same edge twice. So running the import after adding new notes is safe; existing facts won't double up.
5. **Don't make any code edits or call the `/api/chat` endpoint from this command.** Claude Code's tool surface (`Read`/`Glob`) overlaps with the home-ai agent's, but the KG MCP tools are scoped to the home-ai server process — Claude Code can't reach them. The import has to go through the home-ai chat UI (or `curl` against `/api/chat` with an auth cookie if scripting it later, out of scope here).

Notes:

- Why this command isn't doing the import itself: the KG tools (`mcp__kg__record_user_fact` etc.) are MCP tools registered by `server/src/kg/tools.ts`, served only inside the home-ai server's `query()` agent loop. Claude Code is a separate agent process; even if it could write facts somewhere, those facts would land in seed.ts (a build-time source) instead of the live KG.
- If you want a build-time (seed-time) Obsidian import — e.g., facts that survive a `predev` reset — that's a separate workflow worth its own task; it would extend `/seed-fact` rather than this one.
- The home-ai agent's system-prompt rules for this flow live in `server/src/index.ts` under "OBSIDIAN VAULT IMPORT". If you want to tune the heuristics (which note types to skip, what counts as a personal fact), edit there.
