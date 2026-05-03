# Agent tool: propose_node_merge

**Why:** Duplicates accumulate over time (`Person:John` and `Person:John_Doe`, `Topic:typescript` and `Topic:TypeScript`). The agent should propose collapsing them into one node — with the messy edge / embedding / provenance / note bookkeeping — but only on user approval. Most complex tool of M5; lands on its own.
**What:** New `mcp__kg__propose_node_merge(source_ids: number[], target: {name, type, body, reason})` tool. Approval payload: `{kind: "node_merge", sources: [{node, edges, note}...], target}`. Modal renders source list + edges + the proposed unified target (body editable would be ideal but is out of scope — start with read-only target preview; "Tweak" lets the user feed back text to re-propose). On approve: single transaction in `mergeNodes(sourceIds, target)` — for each source, copy edges to target deduped by `(otherEndId, edgeType)`; rewrite provenance rows to target with a `merged_from_<sourceId>` annotation; delete source. Set `node_notes(target.id) = target.body` (overwrite). Re-embed target (background, non-blocking — same posture as `record-fact`). Drop source nodes (FK cascade clears their embeddings + remaining provenance + notes). System prompt: when to propose merges (semantic duplicates that surface across retrievals; user explicitly asks to consolidate).
**Files:** `server/src/kg/db.ts` (mergeNodes function), `server/src/kg/tools.ts`, `server/src/index.ts` (system prompt), `web/src/components/ApprovalModal.tsx` (node_merge render)
**Estimate:** large — touches edges, embeddings, provenance, notes in one transaction
**Dependencies:** m5p1-notes-schema-editor, m5p2-approval-modal
**Smoke steps:**
1. Manually create two nodes that should be one (e.g., `Topic:react` and `Topic:React`) with different edges to other nodes.
2. Ask the agent to merge them; agent invokes `propose_node_merge`.
3. Modal shows source nodes + their edges + the proposed target.
4. Approve — verify: only target remains in graph, all source edges now point at target (deduped where they would collide), no orphan provenance rows, embeddings regenerate within a few seconds, both source nodes are gone from the dashboard stats.
5. Re-run with Deny → both source nodes still exist unchanged.
6. Re-run with Tweak ("name it 'React' with a capital R") → agent re-proposes a target named "React"; approve, verify final state.

---

**Status:** pending
**Started:** —

## Notes
