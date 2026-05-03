---
description: Pick N file-disjoint planned tasks and run them in parallel via story-implementer worktrees
---

Run up to N tasks concurrently. The `story-planner` picks a file-disjoint batch from `tasks/planned/`, the main thread moves each to `tasks/in-progress/`, and parallel `story-implementer` runs in isolated worktrees do the work. Failed agents don't abort the batch — others continue. Each successful run gets offered to the user as a commit on `dev-tl` as it returns.

Argument: `$ARGUMENTS` — target batch size `N` (positive integer).

## Steps

### 1. Validate `N`

- Parse `$ARGUMENTS` as a positive integer.
- If missing or non-positive: ask for a number 1–5 and stop.
- If `N > 5`: refuse. The cap is 5 (Area 5 of the `.claude/` design — `docs/design.md` 2026-05-02 entry). Tell the user "max parallel batch is 5; pick a smaller N or run two batches sequentially." Do not silently clamp — the cap is intentional and the user should be aware.
- If `N == 1`: tell the user `/task-start <slug>` is the simpler path for single-task work, and ask if they want to proceed with the batch flow anyway. If yes, continue.

### 2. Spawn the `story-planner` subagent

Prompt: `Pick up to N=<N> file-disjoint tasks from tasks/planned/ for parallel execution. Honor **Dependencies:** and avoid file conflicts with anything in tasks/in-progress/. Read-only — do not move or edit any files. Report chosen slugs + skipped tasks per your contract.`

Wait for the report. Note: the planner is read-only by contract — it does **not** move files. The main thread does that next.

### 3. Surface the planner's report and confirm

Show the user:
- Chosen slugs (with declared files + estimate + rationale).
- Skipped tasks (dep-blocked, file-conflict, opaque), grouped by reason.
- Counts: `chosen: M / requested: N`.

Ask the user to confirm the batch before claiming. Reasons to pause:
- The planner returned `M < N` and the user may want a different N or to manually massage the queue first.
- The chosen set includes a task the user wasn't expecting to ship next.
- The skipped list reveals a task-authoring issue (e.g., missing `**Files:**`) the user wants to fix first.

If the user confirms, proceed. If they want to adjust, stop.

### 4. Claim each chosen task (move planned → in-progress)

For each chosen slug, in order:
- `mv tasks/planned/<slug>.md tasks/in-progress/<slug>.md`

This is the lock — once a file is in `tasks/in-progress/`, no other planner run will pick it up, and `story-implementer` will treat it as the active task.

Do not edit the file's Status / Started yet; `story-implementer` handles that itself per its contract.

### 5. Spawn parallel `story-implementer` runs in worktrees

For each claimed slug, spawn a `story-implementer` subagent **in an isolated worktree** by passing `isolation: "worktree"` to the Agent tool (the harness auto-creates the worktree on spawn and auto-cleans on agent return — see Area 5 design). All agents run concurrently, not sequentially.

Each agent's prompt: `Implement task slug \`<slug>\`. The task file is at \`tasks/in-progress/<slug>.md\`. Follow your contract.`

Important:
- **Do not block on the first agent.** Fire all spawns, then collect results as each returns.
- **Failed agents don't abort the batch.** The contract guarantees a failing `story-implementer` leaves the task in `tasks/in-progress/` with `Status: blocked` + Notes — the file stays put for human triage. Other agents continue independently.
- **Worktree isolation means the agent's edits live in its own worktree.** When the agent returns, the changes need to be merged back into the main `dev-tl` working tree. The harness's worktree auto-cleanup removes the worktree directory; the diff is what the main thread inspects and commits.

### 6. Process results as each agent returns (commit-as-each-finishes)

For each returned agent, in the order they return:

1. **Read the agent's report.** Surface to the user: outcome (success / blocked), files changed, gate results (typecheck / lint / format / TODO scan / package.json), smoke test outcome, any flags. Match the format the `story-implementer` contract specifies.
2. **If `success`:** Show the suggested commit message. Ask the user whether to commit the changes from this agent's worktree to `dev-tl` now (default yes), or hold for batch review at the end. If yes, commit on `dev-tl` with the suggested message (the user can tweak first). The commit happens on the main `dev-tl` branch — the worktree was just for isolating the work, not for branching.
3. **If `blocked`:** Surface the failure clearly. The task file remains in `tasks/in-progress/` with `Status: blocked`. Don't auto-revert it — the user decides whether to triage now, run `/task-revert <slug>` to send it back to planned, or `/task-start <slug>` to retry once the blocker is resolved. Do not commit any partial work from a blocked agent — the worktree's changes are abandoned with the worktree cleanup.

Continue until all agents have returned.

### 7. Final batch summary

Once all agents have returned, summarize:
- Successes (slug → commit hash if committed, or `pending review` if held).
- Blocked (slug → one-line reason from the agent's report).
- Any cross-cutting flags (multiple agents flagged a shared file outside their declared `**Files:**`, multiple agents added the same dependency, etc.).
- Suggested next step (e.g., "3/4 succeeded; investigate `m45-auth-routes` blocker before retrying").

## Don't

- **Don't exceed N=5.** Hard cap from the Area 5 design. Surface the cap to the user; don't silently clamp.
- **Don't run agents sequentially.** The whole point is parallelism. If you fire them serially, you've defeated the design.
- **Don't skip the worktree isolation.** `isolation: "worktree"` is the mechanism that prevents agents from stomping on each other's filesystem state mid-run. Without it, two agents editing the same `package-lock.json` or running `npm run typecheck` simultaneously will race.
- **Don't auto-commit a blocked agent's partial work.** Blocked = abandoned. The user retries via `/task-start` after fixing the blocker.
- **Don't auto-revert a blocked task.** Leave it in `tasks/in-progress/` with `Status: blocked`. The blocked-state Notes are the trail; reverting wipes the agent-managed state and forces re-discovery.
- **Don't switch branches.** Worktrees are how the agents get isolation; the main thread stays on `dev-tl` throughout.
- **Don't push** — commits happen on `dev-tl` locally; the user pushes when they're ready.
- **Don't bypass `story-planner`.** Even if "I just want to run these 3 specific tasks in parallel" is tempting, the planner's job is to verify file-disjointness and dependency state — skipping it risks the exact merge conflicts the design tries to prevent.

## Notes

- The lock model is **the file move** (`/planned` → `/in-progress`). Once a task is in `/in-progress/`, no other run picks it up. This is why step 4 happens before step 5.
- The defense-in-depth check inside `story-implementer` (re-reading every other in-progress task's `**Files:**` for overlap) catches the case where a manual `/task-start` raced with this batch — it'll abort if it sees a conflict.
- "Commit-as-each-finishes" is the default; "batch review at the end" is the fallback if the noise gets distracting. Either way, every committed change has its own commit on `dev-tl` — don't squash a batch into one commit, the `story-implementer` reports are per-task.
