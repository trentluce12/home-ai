---
description: Audit .claude/ for stale entries, undocumented additions, and orphans; produce a fresh task with findings
---

Per-milestone consistency + housekeeping check on the `.claude/` folder. Without an invocation log we can't measure usage, but we can flag inventory drift (file vs `CLAUDE.md` mismatch), likely orphans (no codebase references + 60+ days untouched), and recent additions worth re-reading at milestone close. The output is a task file in `tasks/planned/` so the user decides what to act on; nothing auto-deletes.

## Steps

### 1. Enumerate `.claude/` content

List every file under each of these paths (one level deep is fine; skills nest one folder deeper):

- `.claude/agents/*.md` — subagent contracts
- `.claude/commands/*.md` — slash command definitions
- `.claude/skills/*/SKILL.md` — project-scoped skills (folder per skill, with a `SKILL.md` inside)

Collect each entry as a `{kind, name, path}` triple where:
- `kind` ∈ `agent | command | skill`
- `name` = file basename without `.md` for agents/commands; folder name for skills
- `path` = repo-relative path (e.g., `.claude/agents/bug-hunter.md`)

Also scan for anything that doesn't match the expected shape (e.g., a stray `.md` directly under `.claude/skills/`, or a non-`.md` file under `.claude/agents/`). Surface those as a separate `Unexpected layout` bucket — they're not findings against any one entry, but the user should know.

### 2. For each entry, gather facts

Per entry collect:

- **Last git-modified date.** Run `git log -1 --format=%ai -- <path>`. If the entry is brand-new (untracked), record `untracked` instead — it'll surface under `Recent additions` regardless.
- **Mentioned in `CLAUDE.md` inventory?** Read `CLAUDE.md` once at the start; check whether the literal entry name appears anywhere in it (backtick-quoted is the canonical form, but plain mentions count too). Cache the file contents — don't re-read per entry.
- **Codebase references.** Use `Grep` to search the whole repo for the entry name as a literal token. Scope: exclude `.claude/worktrees/**` (transient), `node_modules/**`, `.git/**`, `dist/**`. Include the entry's own file in the grep (a self-reference doesn't count as a "real" reference — track and subtract). What counts as a reference:
  - For commands: the slug appears in any `.md`, `.ts`, `.tsx`, or `.json` file outside `.claude/commands/<slug>.md` itself.
  - For agents: the agent name appears in any file outside `.claude/agents/<name>.md` and outside the agent's own definition.
  - For skills: the skill name appears in any file outside `.claude/skills/<name>/SKILL.md`.

  Surfacing: count (excluding self), and a 1–3 path sample so the user can spot-check.

- **Days since last modification.** From the git date, compute `now - last_modified_date` in whole days. Use the harness-provided current date as `now`. `untracked` entries get `0` days (brand-new).

### 3. Bucket the findings

Each entry can land in 0 or more buckets. Compute these buckets in this order:

1. **Undocumented** — the entry is on disk but its name does NOT appear in `CLAUDE.md`. `CLAUDE.md` is supposed to be the inventory; missing entries either need to be added there or removed from disk. List the entry path + kind.

2. **Phantom** — the entry name appears in `CLAUDE.md` (under `## Subagents`, `## Skills`, or the slash-command list in `## Task workflow` / similar) but no matching file exists on disk. `CLAUDE.md` claims something that's not there. To detect: parse the obvious inventory locations in `CLAUDE.md` (backtick-quoted names like `\`/check\``, `\`bug-hunter\``, `\`typescript\``) and check each against the on-disk inventory from step 1.

3. **Possibly orphan** — `0` codebase references (excluding self) AND last modified `>= 60 days ago`. These are the deprecation candidates the design log calls out. List the entry + days-untouched + ref count.

4. **Recent additions** — last modified within the time window since the last shipped milestone. Determine the cutoff:
   - Read `docs/milestones.md`. The most recent shipped milestone is the latest top-level `## M<N>...` section marked `(shipped)` or `(shipped ✓)`. Find its newest design-log entry in `docs/design.md` (header pattern `### YYYY-MM-DD · ...`) — that date is the cutoff.
   - If unclear (e.g., first milestone audit, or the milestones file has changed format), fall back to "modified within the last 14 days." Note the fallback in the task file so the user can correct.
   - List entry + last-modified date + a 1-line summary of what it does (read the entry's frontmatter `description:` field for commands/skills, or the first heading-line for agents).

If a bucket is empty, write `(none)` rather than omitting the section — empty results are themselves a useful signal.

### 4. Write findings to `tasks/planned/`

Compute today's date in `YYYY-MM-DD` format (use the harness-provided current date — don't fabricate).

Use `Write` to create `tasks/planned/chore-audit-claude-folder-<YYYY-MM-DD>.md`. Format (substitute `<date>`, fill the buckets):

```
# .claude/ audit — <date>

**Why:** Per-milestone consistency + housekeeping check on `.claude/`. Findings below; the user decides which (if any) become follow-up tasks. No auto-deletion.
**What:** Review each bucket. For real issues, spin off a `chore-` task via `/task-new`. For false positives, leave a note here.
**Files:** TBD — depends on which findings the user decides to act on.
**Estimate:** 30 min review
**Dependencies:** none
**Smoke steps:** N/A — this is a review task, not a code change.

---

**Status:** pending
**Started:** —

## Findings

### Undocumented (in `.claude/` but missing from `CLAUDE.md`)

<list, or `(none)`>

### Phantom (in `CLAUDE.md` but missing from `.claude/`)

<list, or `(none)`>

### Possibly orphan (no codebase refs, 60+ days untouched)

<list with last-modified date + ref count, or `(none)`>

### Recent additions (since last milestone close: <cutoff-date>)

<list with last-modified date + 1-line description, or `(none)`>

### Unexpected layout

<list of files that don't fit the expected shape, or `(none)`>

## Inventory snapshot

For reference, here's what's on disk at audit time (kind / name / last-modified / ref count):

| kind    | name                     | last-modified | refs |
|---------|--------------------------|---------------|------|
| agent   | bug-hunter               | YYYY-MM-DD    | N    |
...

## Notes
```

Match the agent-managed task-file format (Status / Started / Notes after `---`). The Notes section starts empty.

### 5. Report to the user

Surface:
- The path of the new task file (`tasks/planned/chore-audit-claude-folder-<date>.md`).
- Per-bucket counts (`Undocumented: 2, Phantom: 0, Possibly orphan: 1, Recent additions: 7, Unexpected layout: 0`).
- The cutoff date used for `Recent additions` and which milestone it came from (or `fallback: 14 days` if the heuristic kicked in).
- A single-sentence summary tilt: "queue is consistent" / "2 entries undocumented + 1 likely orphan worth reviewing" / etc.
- Suggested next step — `/task-start chore-audit-claude-folder-<date>` if there are real findings, or `rm tasks/planned/chore-audit-claude-folder-<date>.md` if everything is clean and the user just wants the negative-result confirmation.

## Don't

- **Don't auto-delete or auto-edit any `.claude/` content.** This command is read-only against `.claude/` itself; the only write is the new task file. Removal decisions are explicitly the user's call (per the Improvement lifecycle in `CLAUDE.md`).
- **Don't run typecheck, lint, or any other gates.** Pure inspection task.
- **Don't commit.** Same as every other slash command — main thread reviews and commits.
- **Don't include `.claude/worktrees/**` in the inventory or grep scope.** Worktrees are transient per-agent state, not real `.claude/` content.
- **Don't consider self-references as real references.** The entry's own definition file mentioning its name doesn't count toward the codebase-ref count — that's the trivial case.
- **Don't try to be smart about "soft" references in prose.** A skill named `react` will collide with thousands of incidental mentions of React across the repo. The grep is for the literal entry name as a token; if false-positive collisions are a problem (especially for short skill names), note the collision risk in the report and let the user judge.

## Notes

- **Why a fresh task file every audit.** The design log (Area 3) chose queue-tracked over ephemeral so findings stay in the workflow until the user closes them out. Each audit gets a dated file; old ones can be `rm`'d once reviewed.
- **Cadence.** Per-milestone, not time-based. Run `/audit-claude-folder` when closing an M-level milestone — the natural reflection point.
- **Short skill name collisions.** Skills like `react`, `typescript`, `hono` will appear in thousands of import statements and file paths. Refs counted as "non-zero" doesn't mean the skill is in active use as a Claude skill; it means the literal token appears. The bucket logic is conservative — `Possibly orphan` requires both 0 refs AND 60+ days untouched. If a frequently-imported library shares a name with a skill, that skill will never trip `Possibly orphan` even if it's actually unused — that's a known limitation, not a bug.
- **Untracked entries.** Brand-new files (added but not committed) show as `untracked` in the last-modified column and always land in `Recent additions`. That's correct: an unaudited new entry is exactly the thing this command exists to surface.
- **First audit.** If there's no shipped-milestone date to work from, the 14-day fallback will likely include nearly everything in `Recent additions` (since `.claude/` is being built out as of M4.5). That's expected — the first audit is a baseline; subsequent audits' `Recent additions` will be tighter.
