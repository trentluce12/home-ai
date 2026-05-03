---
name: anthropic-sdk
description: home-ai project rules for the Anthropic SDK and Claude Agent SDK — model choice, streaming pattern, typed errors, no-Promise-wrapping. Project-scoped layer on top of the global `claude-api` skill. TRIGGER when editing files that import `@anthropic-ai/sdk` or `@anthropic-ai/claude-agent-sdk`. SKIP for other-provider SDKs or files calling the Voyage embeddings API directly.
---

# anthropic-sdk — home-ai project rules

This skill is the project layer on top of the global `claude-api` skill. The
global skill handles model migration, prompt caching, adaptive thinking, etc. —
**don't duplicate that here**. The rules below are home-ai-specific decisions
the global skill can't know about.

## Rules

- **Model:** use `claude-opus-4-7`. Never downgrade for cost — that's the user's
  call, not yours.
- **Streaming:** call `messages.stream()` and consume the async iterator
  directly, then await `.finalMessage()` if you need the full result. **Never
  wrap stream events in `new Promise()`** — that's an anti-pattern that has
  appeared before and breaks backpressure / error propagation. Forward deltas
  to the client as they arrive.
- **Types:** use SDK types (`Anthropic.MessageParam`, `Anthropic.Message`,
  `Anthropic.ContentBlock`, etc.). Don't redefine equivalents.
- **Errors:** use typed exceptions (`Anthropic.RateLimitError`,
  `Anthropic.APIError`, `Anthropic.AuthenticationError`, etc.) — `instanceof`
  checks only. Never string-match error messages.
- **Voyage embeddings:** raw `fetch` is fine. Voyage isn't in the Anthropic SDK,
  and the established pattern lives in `server/src/embeddings/voyage.ts`. Don't
  invent an SDK wrapper for it.
- **Agent SDK:** `permissionMode: "bypassPermissions"` is the project default
  — this is a personal-trusted environment. Already wired in
  `server/src/index.ts`; don't second-guess it.

## What the global `claude-api` skill covers (don't duplicate)

- Model migration (4.5 → 4.6 → 4.7, retired-model replacements)
- Prompt caching design and tuning
- Adaptive thinking, compaction, tool use, batch, files, citations, memory
- Generic SDK debugging
