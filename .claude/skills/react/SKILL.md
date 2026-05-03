---
name: react
description: home-ai's React conventions — function components, hook discipline, derived-state-in-render. TRIGGER when editing `.tsx` files in `web/src/` (components, App.tsx, hooks). SKIP for non-React TS (server/, plain `.ts` files), styling-only changes (use the `tailwind` skill instead).
---

# react — home-ai project conventions

Rules for writing React in `web/src/`. The web app is Vite + React + TypeScript; canonical components live in `web/src/components/` (`MessageBubble.tsx`, `MemoryPanel.tsx`, `SessionList.tsx`, `EmptyDashboard.tsx`, `GraphView.tsx`). Read those when in doubt — they're the project's house style for hooks, props typing, and event handling.

## Rules

### Function components only

No class components. Every component is a named function (`export function Foo() { ... }`) or a `const Foo = () => ...` for trivial wrappers. No `extends React.Component`.

### Pick the right state primitive

- **`useState`** — synchronous state that *should* trigger a re-render when it changes. UI-visible values (input text, modal open/closed, list of messages).
- **`useRef`** — high-frequency or out-of-render state that *shouldn't* re-render. Examples in this codebase:
  - `stickToBottomRef` in `web/src/App.tsx` — tracks whether the user is scrolled near the bottom. The scroll listener fires far too often to round-trip through React; a ref keeps it cheap.
  - `AbortController` handles for in-flight `fetch` calls.
  - DOM node references for measurement / imperative APIs.

If you find yourself debouncing `setState` to silence renders, you probably want a ref instead.

### `useEffect` hygiene

- **Dependencies are exhaustive.** Every value from component scope used inside the effect goes in the deps array. The `react-hooks/exhaustive-deps` lint rule (project lint config) will catch omissions — don't suppress it without a written reason in a comment.
- **Don't `useEffect` for derived state.** If a value can be computed from props/state, compute it in render — don't store it in `useState` and sync via effect. Effects are for *side effects* (subscriptions, fetches, imperative DOM/API calls), not for keeping two pieces of state in lockstep.

  Bad:

  ```tsx
  const [filtered, setFiltered] = useState<Item[]>([]);
  useEffect(() => {
    setFiltered(items.filter((i) => i.visible));
  }, [items]);
  ```

  Good:

  ```tsx
  const filtered = items.filter((i) => i.visible);
  ```

  (Wrap with `useMemo` only if the filter is genuinely heavy — see below.)

### Memoization is a tool, not a default

- **`useCallback`** — only when the callback is passed to a memoized child (`React.memo`, or a child that uses it in a `useEffect` dep array). For un-memoized children, wrapping in `useCallback` is overhead with no benefit; the child re-renders anyway when the parent does.
- **`useMemo`** — for genuinely heavy computations (large array transforms, expensive parses). Don't wrap a `.map()` over 5 items. The cost of the equality check + memo bookkeeping often exceeds what you save on small data.

When in doubt, leave it un-memoized. Profile, then memoize the actual hot spot.

## Canonical examples

- `web/src/App.tsx` — orchestrator component: `useState` for messages/sessions, `useRef` for scroll tracking and abort controllers, `useEffect` for SSE stream lifecycle.
- `web/src/components/MessageBubble.tsx` — pure render with a tiny `useState` for the copy-button "copied" flash.
- `web/src/components/GraphView.tsx` — heavier component with `useEffect` for graph lifecycle (fetch + sigma instantiation + cleanup), refs for DOM mounts.
- `web/src/components/SessionList.tsx` — list rendering with event handlers; no premature memoization.
