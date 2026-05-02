# Login page + auth-state gate in SPA

**Why:** User-facing entry to the auth flow.

**What:** Login component with a single password input that POSTs `/api/auth/login`. On error: show "incorrect password" without leaking whether the env hash exists. App root checks `/api/auth/me` on mount: if unauthenticated, render `<Login />`; otherwise render the existing 3-column app shell. Logout button somewhere quiet (header? memory panel footer?).

**Files:** `web/src/components/Login.tsx` (new), `web/src/App.tsx`

**Estimate:** TBD
