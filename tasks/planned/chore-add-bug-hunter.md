# Add bug-hunter subagent

**Why:** Bug investigation in main thread is slow + consumes lots of context. Encapsulate in a focused subagent with read-mostly tools.

**What:** Create `.claude/agents/bug-hunter.md` with contract:
- **Input**: bug description (symptoms, repro steps if known)
- **Steps**: reproduce → narrow → identify root cause → propose fix
- **Default = investigate, not fix.** Only fixes if input explicitly says "and fix it"
- Honest about uncertainty: if can't reproduce, says so. If multiple causes plausible, lists them with confidence levels.
- **Report**: root cause + proposed fix (file + line + change) + confidence + alternatives considered + smoke test the fix would need

Tools: `Read`, `Glob`, `Grep`, `Bash` (for repro). `Edit`/`Write` only if explicitly told to fix.
Model: `opus` (root-cause analysis benefits from deeper reasoning).

**Files:** `.claude/agents/bug-hunter.md` (new)

**Estimate:** 1 hr

**Dependencies:** none

**Smoke steps:** Invoke with a known-fixed bug (e.g., from git log); verify root cause matches and confidence is appropriately high.

---

**Status:** pending
**Started:** —

## Notes
