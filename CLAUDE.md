# home-ai — project notes

A personal "home AI" — chat UI on top of the Anthropic API. Knowledge graph context comes in M1.

## Where context lives

- **`docs/design.md`** — architecture overview + decisions log (read this first)
- **`docs/milestones.md`** — M-level status: what's shipped, what's next
- **`tasks/planned/`, `tasks/in-progress/`** — per-story markdown files for pending work (Why / What / Files / Estimate)
- **This file** — coding conventions and stack at a glance

When making non-trivial decisions, append an entry to `docs/design.md`. When closing out a milestone phase, update `docs/milestones.md`. Per-story state changes happen via the task workflow below — `docs/` reflects shipped reality, `tasks/` reflects pending work.

## Task workflow

Lifecycle: write a task in `tasks/planned/`, move to `tasks/in-progress/` when picking it up, delete on completion. Slash commands handle the file ops:

- `/task-new <title>` — scaffold a new task in `tasks/planned/`
- `/task-start <slug>` — move planned → in-progress
- `/task-done <slug>` — delete the in-progress file + update `docs/milestones.md` / `docs/design.md` if the task closed a phase or made a non-trivial decision
- `/tasks` — list current state (planned + in-progress)

Done = deleted: git history + `docs/` keep the record, no `tasks/done/` graveyard.

## Stack

- **Frontend** — Vite + React + TypeScript + Tailwind (in `web/`)
- **Backend** — Hono + `@anthropic-ai/sdk` with SSE streaming (in `server/`)
- **Workspace** — npm workspaces; `npm run dev` runs both via `concurrently`

## Conventions

- Use `claude-opus-4-7` as the model — don't downgrade for cost, that's the user's call
- Stream responses (`messages.stream()` + `.finalMessage()`); never wrap stream events in `new Promise()`
- Use SDK types (`Anthropic.MessageParam`, `Anthropic.Message`, etc.) — don't redefine equivalents
- Use typed exceptions (`Anthropic.RateLimitError`, etc.) — never string-match error messages
- Tailwind-first styling, dark mode by default

## Useful commands

- `npm run dev` — start both servers (wipes the KG and reseeds it from `server/src/seed.ts` first)
- `npm run typecheck` — typecheck both workspaces
- `/check` — same as above, via slash command

## Seed data

`server/src/seed.ts` is the source of truth for what the KG knows at dev startup. It runs as part of `predev`, so each `npm run dev` resets the database to exactly what's in the `FACTS` array. Append entries as the project gains knowledge worth pinning. Don't rely on facts learned in prior chat sessions surviving a dev restart.

## Don't add until needed

- Subagents (`.claude/agents/`)
- Skills (`.claude/skills/`)
- Hooks
- Prompt caching, adaptive thinking, conversation persistence

These get added when there's real friction to remove, not preemptively.
