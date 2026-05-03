# Approval-request modal infrastructure

**Why:** Agent tools that mutate notes or merge nodes shouldn't apply changes silently. The user gates each change via a structured modal — Approve / Deny / Tweak. Built once, reused by every future "agent proposes X" tool. The infra is the contract; specific tool consumers are downstream.
**What:** Server: typed SSE event `approval_request` with `{requestId, kind, payload}`; matching `POST /api/approval/:requestId` accepting `{decision: "approve" | "deny" | "tweak", tweakText?: string}`. Tool helper `requestApproval(kind, payload): Promise<ApprovalResponse>` stores the resolver in an in-memory `Map<requestId, (decision) => void>`; POST handler looks it up and resolves. The Promise's resolution becomes the agent tool's return value. Clear the resolver on resolve, on tab disconnect, or on a configurable timeout (e.g., 5 min). Client: new `ApprovalModal.tsx` listening to `approval_request` SSE events, rendering payload (kind-specific render dispatched via a switch — initial render is a generic JSON dump, real consumers add their own renders later), 3 buttons. "Tweak" reveals a textarea for free-form prose; submit POSTs `{decision: "tweak", tweakText}`. Smoke via a temporary `mcp__kg__approval_test(payload)` tool that exercises all three paths.
**Files:** `server/src/index.ts` (SSE handler + new endpoint + approval Map), `server/src/kg/tools.ts` (helper + dummy `approval_test` tool for smoke), `web/src/components/ApprovalModal.tsx` (new), `web/src/App.tsx` (mount + SSE wiring), `web/src/lib/api.ts`
**Estimate:** medium-large — concurrency primitive worth getting right
**Dependencies:** none
**Smoke steps:**
1. With dummy `approval_test` tool wired, ask the agent in chat to invoke it.
2. Modal pops with the test payload; click Approve → modal closes, tool returns `{decision: "approve"}`, agent continues with that.
3. Re-run, click Deny → tool returns `{decision: "deny"}`, agent acknowledges.
4. Re-run, click Tweak, type "make it shorter", submit → tool returns `{decision: "tweak", tweakText: "make it shorter"}`; agent re-proposes (or just acknowledges, in the dummy case).
5. Tab close mid-modal → server times out the resolver after the configured window; a fresh chat turn works after.

---

**Status:** pending
**Started:** —

## Notes
