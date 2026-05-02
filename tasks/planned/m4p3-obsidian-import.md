# Obsidian markdown ingestion

**Why:** Bulk seed the KG from existing notes without typing each fact one-by-one through chat.

**What:** Likely run via the agent itself in a one-off flow (use existing `Read` + `Glob` tools to walk a vault, extract facts, call `record_user_fact`) rather than building a structured importer — markdown is too varied to parse reliably. May ship as a slash command (`/import-obsidian <path>`) plus a short system-prompt extension explaining the flow. Decide on idempotency: re-running over the same vault shouldn't duplicate facts (lookup by node name+type before inserting).

**Files:** TBD — likely `.claude/commands/import-obsidian.md` and a small system-prompt addition in `server/src/index.ts`.

**Estimate:** TBD
