// Reusable approval-request infrastructure for agent tools that mutate state
// the user wants to gate (note edits, node merges, etc.). Each tool that wants
// the gate calls `requestApproval(kind, payload)` and awaits the user's
// decision (Approve / Deny / Tweak); the helper threads the in-flight chat's
// SSE stream via AsyncLocalStorage so tools don't need to know about the
// transport layer. The HTTP POST handler that receives the user's click looks
// up the resolver by `requestId` and unblocks the awaiting tool.
//
// Design notes:
// - AsyncLocalStorage scopes the SSE stream to the chat request currently
//   running. The Agent SDK's tool callbacks run inside the same async context
//   as the `query()` consumer (single-process, no thread hop), so ALS reaches
//   them transparently.
// - Disconnect + timeout are both terminal: either path drops the resolver
//   from the Map. A tab close while a modal is open → onAbort rejects all
//   pending approvals tied to that stream; a long-running approval with no
//   user action → the timer fires and resolves with `kind: "timeout"`.
// - The map is process-local. Single-user app, so no need for a shared store.
import { AsyncLocalStorage } from "node:async_hooks";
import type { SSEStreamingApi } from "hono/streaming";
import { nanoid } from "nanoid";

/** Default timeout — 5 minutes. Long enough for real deliberation, short
 *  enough that an abandoned modal doesn't pin a Promise indefinitely. */
export const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

export type ApprovalDecision =
  | { decision: "approve" }
  | { decision: "deny" }
  | { decision: "tweak"; tweakText: string }
  | { decision: "timeout" };

interface ApprovalEntry {
  resolve: (response: ApprovalDecision) => void;
  timer: NodeJS.Timeout;
  stream: SSEStreamingApi;
}

interface ApprovalContext {
  stream: SSEStreamingApi;
}

const approvalStorage = new AsyncLocalStorage<ApprovalContext>();
const pending = new Map<string, ApprovalEntry>();

/** Run a callback with an SSE stream available to any `requestApproval` calls
 *  it triggers (directly or via the agent loop). */
export function withApprovalContext<T>(
  stream: SSEStreamingApi,
  fn: () => Promise<T>,
): Promise<T> {
  return approvalStorage.run({ stream }, fn);
}

/** Block until the user responds via `POST /api/approval/:requestId`, or the
 *  timeout fires, or the SSE stream aborts. Throws if no SSE context is
 *  available (i.e. called outside a chat handler). */
export async function requestApproval(
  kind: string,
  payload: unknown,
): Promise<ApprovalDecision> {
  const ctx = approvalStorage.getStore();
  if (!ctx) {
    throw new Error(
      "requestApproval called outside an approval context — " +
        "wrap the chat handler with withApprovalContext().",
    );
  }
  const { stream } = ctx;

  const requestId = nanoid();
  const resolved = new Promise<ApprovalDecision>((resolve) => {
    const timer = setTimeout(() => {
      const entry = pending.get(requestId);
      if (!entry) return;
      pending.delete(requestId);
      entry.resolve({ decision: "timeout" });
    }, APPROVAL_TIMEOUT_MS);

    pending.set(requestId, { resolve, timer, stream });
  });

  await stream.writeSSE({
    data: JSON.stringify({
      type: "approval_request",
      requestId,
      kind,
      payload,
    }),
  });

  return resolved;
}

/** Called by the POST handler. Returns true iff a pending request matched. */
export function resolveApproval(requestId: string, response: ApprovalDecision): boolean {
  const entry = pending.get(requestId);
  if (!entry) return false;
  pending.delete(requestId);
  clearTimeout(entry.timer);
  entry.resolve(response);
  return true;
}

/** Reject every pending approval owned by a stream that just aborted. The
 *  awaiting tools resolve with `{decision: "timeout"}` so the agent loop
 *  unwinds cleanly rather than hanging on a Promise that will never settle.
 *  We use `timeout` rather than a thrown error so the tool's return value
 *  shape stays uniform for downstream consumers. */
export function cancelApprovalsForStream(stream: SSEStreamingApi): number {
  let count = 0;
  for (const [requestId, entry] of pending) {
    if (entry.stream !== stream) continue;
    pending.delete(requestId);
    clearTimeout(entry.timer);
    entry.resolve({ decision: "timeout" });
    count += 1;
  }
  return count;
}

/** Test seam — exposed for assertions, not for runtime use. */
export function pendingApprovalCount(): number {
  return pending.size;
}
