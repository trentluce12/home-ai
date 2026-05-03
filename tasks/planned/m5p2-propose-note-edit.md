# Agent tool: propose_note_edit

**Why:** First real consumer of the approval modal. Agent can update notes (consolidate duplicate sentences, add detail from chat) but the user sees the diff before it lands.
**What:** New `mcp__kg__propose_note_edit(node_id, new_body, reason)` tool. Implementation: fetch current body via `getNote`, build payload `{kind: "note_edit", node: {id, name, type}, before, after, reason}`, call `requestApproval(...)`. On approve: write via `setNote()`, return "applied". On deny: return "denied by user". On tweak: return `{tweakText}` so the agent can re-propose with the user's adjustment. ApprovalModal gains a `note_edit` render: side-by-side before/after blocks (full diff highlighting can come later — start with before/after rendered as markdown). System prompt addition: when to use this tool (user shares richer context that updates an existing note; consolidating overlapping notes during a conversation that touches both).
**Files:** `server/src/kg/tools.ts`, `server/src/index.ts` (system prompt), `web/src/components/ApprovalModal.tsx` (note_edit render)
**Estimate:** medium
**Dependencies:** m5p1-notes-schema-editor, m5p2-approval-modal
**Smoke steps:**
1. Add a note to a node with stale info ("Snickers is 4 years old").
2. In chat: share new info ("actually, Snickers is 5 now").
3. Agent invokes `propose_note_edit`; modal shows before/after.
4. Click Approve — note updates; verify in dashboard panel.
5. Re-run with Deny → note unchanged; agent acknowledges.
6. Re-run with Tweak ("keep the breed line, just update the age") → agent re-proposes a tighter edit; user approves the second proposal.

---

**Status:** pending
**Started:** —

## Notes
