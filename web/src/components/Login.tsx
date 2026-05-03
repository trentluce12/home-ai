import { useState, type FormEvent } from "react";
import { ArrowRight } from "lucide-react";
import { LoginError, api } from "../lib/api";

interface Props {
  onSuccess: () => void;
}

/**
 * Single-password login screen. Submitting POSTs `/api/auth/login`; on success
 * we call `onSuccess` and the parent re-renders the app shell. On failure we
 * pick copy off the HTTP status without leaking whether the server-side env
 * hash is configured — the user only ever sees "incorrect password" or a
 * rate-limit / generic-server-error message.
 */
export function Login({ onSuccess }: Props) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting || !password) return;
    setError(null);
    setSubmitting(true);
    try {
      await api.login(password);
      onSuccess();
    } catch (err) {
      // Map status → copy. We deliberately collapse 500 (unconfigured env
      // hash) into a generic message so an attacker can't probe whether
      // the server has a password set at all.
      if (err instanceof LoginError) {
        if (err.status === 429) {
          setError("too many attempts, try again in a few minutes");
        } else if (err.status >= 500) {
          setError("server error, try again later");
        } else {
          setError("incorrect password");
        }
      } else {
        // Network failure or unexpected exception. Keep generic.
        setError("could not reach server");
      }
      setPassword("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-dvh items-center justify-center bg-zinc-950 text-zinc-100 font-sans">
      <div className="w-full max-w-sm px-6">
        <div className="mb-8 flex items-baseline justify-center gap-1.5 font-mono text-sm tracking-tight">
          <span className="text-zinc-100">home</span>
          <span className="text-zinc-600">·</span>
          <span className="text-zinc-500">ai</span>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="relative flex items-center gap-2 rounded-2xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 backdrop-blur transition-colors focus-within:border-zinc-700 focus-within:bg-zinc-900">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="password"
              autoFocus
              autoComplete="current-password"
              disabled={submitting}
              className="flex-1 bg-transparent text-zinc-100 placeholder:text-zinc-600 focus:outline-none disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!password || submitting}
              aria-label="sign in"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-900 transition hover:bg-white disabled:bg-zinc-800 disabled:text-zinc-600"
            >
              <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
            </button>
          </div>
          {error && (
            <p role="alert" className="px-2 text-xs text-red-400 animate-fade-in">
              {error}
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
