# Add typescript project skill

**Why:** Area 2 design — coding rules live in `.claude/skills/` as auto-loaded skills, not just docs. TypeScript rules are partially in `CLAUDE.md` today but should be a triggered skill so they auto-load when editing TS code.

**What:** Create `.claude/skills/typescript/SKILL.md` with:

- **Name:** `typescript`
- **Description (with TRIGGER):** Triggers when editing any `.ts` or `.tsx` file in `server/src/` or `web/src/`.
- **Body — rules:**
  - Use SDK types (`Anthropic.MessageParam`, `Anthropic.Message`, etc.) — never redefine equivalents
  - Use typed exceptions (`Anthropic.RateLimitError`, etc.) — never string-match error messages
  - No `any` — use `unknown` and narrow
  - No `!` non-null assertions — handle nullable explicitly
  - Type-only imports for types (`import type { Foo } from 'bar'`)
  - Strict null checks expected (already on in `tsconfig.json`)

**Files:** `.claude/skills/typescript/SKILL.md` (new)

**Estimate:** 30 min

**Dependencies:** none

**Smoke steps:** Edit any `.ts` file in a fresh session; verify the skill loads (check `/skills` or system reminder).

---

**Status:** pending
**Started:** —

## Notes
