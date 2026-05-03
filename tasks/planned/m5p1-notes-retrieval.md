# Notes retrieval integration

**Why:** Notes are dead weight if the agent can't see them during chat. Surface a snippet alongside the parent node in retrieval; add an opt-in tool for the full body when needed.
**What:** In `retrieveSubgraph`, after rehydrating each retrieved node, look up its note (if any) and attach `notePreview` (first ~200 chars). Format the context block to render the preview inline under each node ("note: …"). Add `mcp__kg__get_node_note(id) -> string` tool returning the full body (or "no note" if absent). System prompt: short paragraph explaining when to fetch the full note (preview cuts off mid-sentence on a topic the user just asked about, or the user asks for detail that's clearly past the preview boundary).
**Files:** `server/src/kg/retrieve.ts`, `server/src/kg/tools.ts`, `server/src/index.ts`
**Estimate:** small
**Dependencies:** m5p1-notes-schema-editor
**Smoke steps:**
1. Add a long note (>200 chars) to a node.
2. Ask a chat question that retrieves that node — sidebar shows a context retrieval; preview renders inline in the formatted context block.
3. Ask a follow-up needing detail past the cutoff — agent calls `get_node_note`, returns full body, answers correctly.
4. With a note-less node retrieved, no `notePreview` field appears in the formatted context (clean omission, not empty string).

---

**Status:** pending
**Started:** —

## Notes
