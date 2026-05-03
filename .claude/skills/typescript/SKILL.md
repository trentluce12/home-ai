---
name: typescript
description: home-ai TypeScript rules — SDK types over hand-rolled equivalents, typed exceptions over message-matching, no `any`, no `!` non-null assertions, type-only imports for types. TRIGGER when editing any `.ts` or `.tsx` file under `server/src/**` or `web/src/**`. SKIP for non-TS code, generated files, or `node_modules`.
---

# typescript — home-ai project rules

Both workspaces (`server/`, `web/`) run with `strict: true` and `noUncheckedIndexedAccess` in `tsconfig.json`. ESLint 9 + `typescript-eslint` recommended rules are enforced via `npm run lint`. The rules below codify the project's house style on top of those baselines — follow them when writing or editing TS.

## Rules

- **Use SDK types — don't redefine equivalents.** When a type is exported by a dependency, import it instead of hand-rolling. The Anthropic SDK exposes `Anthropic.MessageParam`, `Anthropic.Message`, `Anthropic.ContentBlock`, etc.; the Agent SDK exposes session and query types; Hono exposes `Context`, etc. Redefining (`type Message = { role: ...; content: ... }`) drifts from the upstream shape and produces silent breakage on SDK upgrades.

- **Use typed exceptions — never string-match error messages.** Catch with `instanceof` against the SDK's exception classes (`Anthropic.RateLimitError`, `Anthropic.APIError`, `Anthropic.AuthenticationError`, etc.). Matching on `error.message.includes("rate limit")` is brittle — message text isn't a stable contract and changes between SDK versions break the check silently.

  ```ts
  try {
    await client.messages.stream({ ... });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      // handle rate limit
    } else if (err instanceof Anthropic.APIError) {
      // handle other API error
    } else {
      throw err;
    }
  }
  ```

- **No `any`.** Use `unknown` for values you can't type yet, then narrow with `typeof`, `instanceof`, or a type guard before use. `any` disables type-checking everywhere it flows; `unknown` forces a check at the boundary. If you genuinely don't know the shape (e.g., parsing untrusted JSON), type as `unknown` and validate.

- **No `!` non-null assertions.** Handle nullability explicitly with a guard, an early return, or a default. `foo!.bar` lies to the type system and turns a runtime null into a confusing crash far from the source.

  Bad:

  ```ts
  const node = kg.getNode(id)!;
  return node.name;
  ```

  Good:

  ```ts
  const node = kg.getNode(id);
  if (!node) throw new HTTPException(404, { message: "node not found" });
  return node.name;
  ```

  Exception: when a check is inside a `try` block that the type system can't narrow through (rare), prefer a local `const x = maybeX; if (!x) throw ...` pattern over `!`.

- **Type-only imports for types.** When importing only types, use `import type { Foo } from 'bar'`. This keeps the import out of the emitted JS (no runtime cost, no accidental side-effect imports) and makes intent obvious to readers.

  ```ts
  import type { Anthropic } from "@anthropic-ai/sdk";
  import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
  ```

  For mixed imports (type + value from the same module), use the inline `type` qualifier:

  ```ts
  import { Anthropic, type MessageParam } from "@anthropic-ai/sdk";
  ```

- **Strict null checks are on — write code that respects them.** `tsconfig.json` enables `strict: true` (which includes `strictNullChecks`) plus `noUncheckedIndexedAccess` in both workspaces. That means `array[i]` is typed `T | undefined`, optional props are `T | undefined`, and the compiler will refuse to let you treat a possibly-undefined value as defined. Don't fight it with `!` or `as`; structure the code so the narrow happens naturally (early return, default value, guard clause).

## Cross-references

- **Anthropic / Agent SDK specifics** — see the `anthropic-sdk` skill for the project's stance on streaming, model choice, and the no-`new Promise()`-around-stream-events anti-pattern.
- **React component conventions** — see the `react` skill for hook discipline (typed `useState<T>`, ref types, `useEffect` deps).
- **Hono request/response typing** — see the `hono` skill for `c.req.json<T>()`, params, and middleware shape.
