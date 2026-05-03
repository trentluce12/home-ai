# Add tailwind project skill

**Why:** Area 2 — styling conventions (dark-mode default, prose-invert, Geist fonts) should auto-load when editing JSX with `className`.

**What:** Create `.claude/skills/tailwind/SKILL.md` with:

- **Name:** `tailwind`
- **Description (with TRIGGER):** Triggers when editing `.tsx` files in `web/src/` (broad — `className` is everywhere there).
- **Body — rules:**
  - Tailwind-first; no separate CSS files except global resets in `web/src/index.css`
  - Dark mode is the default — use bare classes for dark, `light:` variants only if a light mode is ever added
  - Markdown content: wrap in `prose prose-invert` for dark-themed prose
  - Font: Geist family is the project default (set globally in `index.css`)
  - Long `className` strings are fine; don't extract just for length. Extract when reused 3+ times.
  - Group related utilities visually (layout / spacing / color / typography)

**Files:** `.claude/skills/tailwind/SKILL.md` (new)

**Estimate:** 30 min

**Dependencies:** none

**Smoke steps:** Edit a `.tsx` file with `className=`; verify skill loads.

---

**Status:** pending
**Started:** —

## Notes
