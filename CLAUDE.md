# home-ai — project notes

A personal "home AI" — chat UI on top of the Anthropic API. Knowledge graph context comes in M1.

## Where context lives

- **`docs/design.md`** — architecture overview + decisions log (read this first)
- **`docs/milestones.md`** — M0–M4 status, what's done, what's next
- **This file** — coding conventions and stack at a glance

When making non-trivial decisions, append an entry to `docs/design.md`. When finishing or starting milestone work, update `docs/milestones.md`.

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

- `npm run dev` — start both servers
- `npm run typecheck` — typecheck both workspaces
- `/check` — same as above, via slash command

## Don't add until needed

- Subagents (`.claude/agents/`)
- Skills (`.claude/skills/`)
- Slash commands beyond `/check`
- Hooks
- Prompt caching, adaptive thinking, conversation persistence

These get added when there's real friction to remove, not preemptively.
