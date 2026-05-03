import { useEffect, useRef, useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import { api, type ApprovalDecision, type ApprovalRequest } from "../lib/api";

interface Props {
  request: ApprovalRequest;
  /** Called once the server has acknowledged the response. The parent then
   *  drops the modal from view. */
  onResolved: (decision: ApprovalDecision) => void;
}

/**
 * Reusable approval-request UI. Renders an `approval_request` SSE payload
 * with three actions:
 *
 * - **Approve** — POST `{decision: "approve"}` and dismiss.
 * - **Deny**    — POST `{decision: "deny"}` and dismiss.
 * - **Tweak**   — reveals a textarea for free-form prose; on submit POSTs
 *                 `{decision: "tweak", tweakText}`. The text feeds back into
 *                 the agent loop as the tool's return value.
 *
 * Payload rendering is dispatched via `request.kind`. The default branch is a
 * generic JSON dump — real tool consumers (note edits, node merges) plug in
 * their own renders as M5 progresses.
 */
export function ApprovalModal({ request, onResolved }: Props) {
  const [mode, setMode] = useState<"actions" | "tweaking">("actions");
  const [tweakText, setTweakText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tweakRef = useRef<HTMLTextAreaElement>(null);

  // Focus the textarea when entering tweak mode so the user can type
  // immediately without an extra click.
  useEffect(() => {
    if (mode === "tweaking") tweakRef.current?.focus();
  }, [mode]);

  async function send(decision: ApprovalDecision) {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.respondApproval(request.requestId, decision);
      onResolved(decision);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to respond");
      setSubmitting(false);
    }
  }

  function handleTweakSubmit() {
    const trimmed = tweakText.trim();
    if (!trimmed) {
      setError("Tweak text is required");
      return;
    }
    void send({ decision: "tweak", tweakText: trimmed });
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-label="approval request"
    >
      <div className="mx-4 w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl">
        <div className="flex items-baseline justify-between border-b border-zinc-900 px-5 py-3">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-medium text-zinc-100">Agent wants to</span>
            <span className="rounded bg-zinc-900 px-2 py-0.5 font-mono text-xs text-zinc-300">
              {request.kind}
            </span>
          </div>
        </div>

        <div className="px-5 py-4">
          <PayloadRender kind={request.kind} payload={request.payload} />
        </div>

        {mode === "tweaking" ? (
          <div className="flex flex-col gap-2 border-t border-zinc-900 px-5 py-4">
            <label className="text-xs uppercase tracking-wider text-zinc-500">
              Tweak instructions
            </label>
            <textarea
              ref={tweakRef}
              value={tweakText}
              onChange={(e) => setTweakText(e.target.value)}
              placeholder="e.g., make it shorter, lean less formal, drop the second paragraph…"
              rows={3}
              disabled={submitting}
              className="resize-y rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-700 focus:bg-zinc-900 focus:outline-none disabled:opacity-50"
            />
            {error && (
              <p role="alert" className="text-xs text-red-400">
                {error}
              </p>
            )}
            <div className="mt-1 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setMode("actions");
                  setError(null);
                }}
                disabled={submitting}
                className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 transition hover:bg-zinc-800 disabled:opacity-50"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleTweakSubmit}
                disabled={submitting || !tweakText.trim()}
                className="rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-900 transition hover:bg-white disabled:bg-zinc-800 disabled:text-zinc-600"
              >
                Send tweak
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2 border-t border-zinc-900 px-5 py-4">
            {error && (
              <p role="alert" className="text-xs text-red-400">
                {error}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => void send({ decision: "deny" })}
                disabled={submitting}
                className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 transition hover:bg-zinc-800 disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" />
                Deny
              </button>
              <button
                type="button"
                onClick={() => setMode("tweaking")}
                disabled={submitting}
                className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 transition hover:bg-zinc-800 disabled:opacity-50"
              >
                <Pencil className="h-3.5 w-3.5" />
                Tweak
              </button>
              <button
                type="button"
                onClick={() => void send({ decision: "approve" })}
                disabled={submitting}
                className="flex items-center gap-1.5 rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-900 transition hover:bg-white disabled:bg-zinc-800 disabled:text-zinc-600"
              >
                <Check className="h-3.5 w-3.5" />
                Approve
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Per-`kind` payload rendering. Future tools (`note_edit`, `node_merge`) add
 * their own branches; the default is a JSON dump so unknown kinds still show
 * something useful.
 */
function PayloadRender({ kind, payload }: { kind: string; payload: unknown }) {
  switch (kind) {
    // Real consumers land here as M5 phase 2 / 3 progress, e.g.:
    //   case "note_edit": return <NoteEditPayload payload={payload as ...} />;
    //   case "node_merge": return <NodeMergePayload payload={payload as ...} />;
    default:
      return (
        <pre className="max-h-72 overflow-auto rounded-lg border border-zinc-900 bg-zinc-900/50 p-3 font-mono text-xs text-zinc-300">
          {safeStringify(payload)}
        </pre>
      );
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
