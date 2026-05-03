# Add anthropic-sdk project skill (project layer on global `claude-api`)

**Why:** Area 2 — there's already a global `claude-api` skill that covers SDK conventions and prompt caching. The project layer adds home-ai specifics (model choice, streaming pattern, no-Promise-wrapping rule) so they auto-load when editing SDK code.

**What:** Create `.claude/skills/anthropic-sdk/SKILL.md` with:

- **Name:** `anthropic-sdk` (project-scoped — distinct from global `claude-api`)
- **Description (with TRIGGER):** Triggers when editing files that import `@anthropic-ai/sdk` or `@anthropic-ai/claude-agent-sdk`.
- **Body — rules (project-specific layer on top of global `claude-api`):**
  - Use `claude-opus-4-7` as the model — never downgrade for cost (that's the user's call)
  - Stream responses: `messages.stream()` + `.finalMessage()`; **never wrap stream events in `new Promise()`** (anti-pattern that has appeared before)
  - Use SDK types (`Anthropic.MessageParam`, `Anthropic.Message`) and typed exceptions (`Anthropic.RateLimitError`) — never string-match error messages
  - For Voyage embeddings: raw `fetch` is OK since Voyage isn't in the SDK (established pattern in `server/src/kg/embeddings.ts`)
  - Agent SDK: use `permissionMode: "bypassPermissions"` for the personal-trusted environment (already set)
  - The global `claude-api` skill handles model migration, caching tuning, etc. — don't duplicate that here.

**Files:** `.claude/skills/anthropic-sdk/SKILL.md` (new)

**Estimate:** 30 min

**Dependencies:** none

**Smoke steps:** Edit a file importing `@anthropic-ai/sdk`; verify both skills load (global `claude-api` + project `anthropic-sdk`).

---

**Status:** pending
**Started:** —

## Notes
