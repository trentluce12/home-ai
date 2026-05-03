# Add /audit-claude-folder command

**Why:** Area 3 design — per-milestone audit of `.claude/` to surface stale entries, undocumented additions, and orphans. Without an invocation log this is a consistency + housekeeping check, not a usage check, but that's still useful.

**What:** Create `.claude/commands/audit-claude-folder.md` that:

- Lists every file in `.claude/agents/`, `.claude/commands/`, `.claude/skills/`
- For each, checks:
  - Last git-modified date (`git log -1 --format=%ai -- <file>`)
  - Whether it's mentioned in the CLAUDE.md inventory (consistency check)
  - Whether anything in the codebase references it by name (orphan detection via Grep)
- Surfaces findings in four buckets:
  - **Undocumented:** in `.claude/` but not listed in CLAUDE.md inventory
  - **Phantom:** mentioned in CLAUDE.md but file missing
  - **Possibly orphan:** no codebase references, not modified in 60+ days
  - **Recent additions:** created since the last milestone closed
- Writes findings to `tasks/planned/chore-audit-claude-folder-<YYYY-MM-DD>.md` (queue-tracked, not ephemeral). The user decides what to act on; no auto-deletion.

**Files:** `.claude/commands/audit-claude-folder.md` (new)

**Estimate:** 1 hr

**Dependencies:** chore-update-claude-md (audit checks consistency against the CLAUDE.md inventory built there)

**Smoke steps:** Run `/audit-claude-folder` against current state; verify it produces a `tasks/planned/chore-audit-claude-folder-*.md` with at least the "Recent additions" bucket populated (since we just added a lot).

---

**Status:** pending
**Started:** —

## Notes
