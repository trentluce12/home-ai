# Add react project skill

**Why:** Area 2 — React-specific patterns (hooks, refs, derived state) should auto-load when editing web code.

**What:** Create `.claude/skills/react/SKILL.md` with:

- **Name:** `react`
- **Description (with TRIGGER):** Triggers when editing `.tsx` files in `web/src/`.
- **Body — rules:**
  - Function components only; no class components
  - `useState` for synchronous state; `useRef` for high-frequency state that doesn't need to trigger re-renders (e.g., scroll position — see `stickToBottomRef` in `web/src/App.tsx`)
  - `useEffect` deps must be exhaustive — exhaustive-deps lint rule (once `chore-lint-format` ships)
  - Don't `useEffect` for derived state — compute in render
  - Memoize callbacks with `useCallback` only when passed to memoized children; otherwise it's overhead
  - `useMemo` for heavy computations; not for trivial ones
  - Cross-reference: existing components in `web/src/components/` as canonical examples

**Files:** `.claude/skills/react/SKILL.md` (new)

**Estimate:** 30 min

**Dependencies:** none

**Smoke steps:** Edit `web/src/App.tsx`; verify skill loads.

---

**Status:** pending
**Started:** —

## Notes
