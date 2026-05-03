# Add refactorer subagent

**Why:** Mechanical multi-file refactors (rename a function across N files, change a signature everywhere, extract a module) are tedious in main thread.

**What:** Create `.claude/agents/refactorer.md` with contract:
- **Input**: refactor description (what's changing, scope, equivalence guarantee)
- **Steps**: identify all affected sites → make the change → run `npm run typecheck` → report
- **Behavior preservation**: refactor must NOT change observable behavior. If an unavoidable behavior change is needed, agent stops and reports rather than proceeding.
- **Pure-mechanical bias**: doesn't invent improvements ("while I was here I also..."). Spots adjacent issues but doesn't fix them — flags in the report instead.
- **Report**: files changed, sites updated, typecheck result, anything skipped or weird
- Doesn't commit (main thread does)

Tools: `Read`, `Edit`, `Write`, `Glob`, `Grep`, `Bash`.
Model: `opus` (refactors benefit from understanding context, not just pattern matching).

**Files:** `.claude/agents/refactorer.md` (new)

**Estimate:** 1 hr

**Dependencies:** none

**Smoke steps:** Invoke with a small rename (e.g., a local utility function); verify all call sites updated, typecheck passes, no behavior change.

---

**Status:** pending
**Started:** —

## Notes
