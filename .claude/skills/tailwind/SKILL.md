---
name: tailwind
description: TRIGGER when editing `.tsx` files under `web/src/**` (broad — `className=` is everywhere there). Project-specific Tailwind conventions for home-ai's chat UI — dark-mode-first, prose-invert for markdown, Geist as the global font, in-line utility classes over extracted styles.
---

# tailwind — home-ai styling conventions

home-ai's web app is Tailwind-first. Global resets and the font stack live in `web/src/index.css`; everything else is utility classes on JSX. Follow these rules when editing components.

## Rules

- **Tailwind-first; no separate CSS files.** The only CSS file is `web/src/index.css` (Tailwind directives, Geist font-family on `body`, scrollbar overrides, selection color). Don't add `.module.css`, `.scss`, or component-scoped stylesheets. If a utility doesn't exist for what you need, extend `tailwind.config.js` rather than reaching for plain CSS.

- **Dark mode is the default — bare classes are dark.** The `body` background is `#0a0a0a` (pure black), text is zinc-100. Write `bg-zinc-900 text-zinc-100 border-zinc-800` directly — don't prefix with `dark:`. If a light mode is ever added, use `light:` variants then; until that day, no `dark:` prefixes appear in the codebase.

- **Markdown content: `prose prose-invert`.** Assistant messages and any rendered markdown surface use the Tailwind typography plugin. The canonical wrapper is `prose prose-invert prose-sm max-w-none` (see `web/src/components/MessageBubble.tsx`). `prose-invert` flips the typography palette for dark backgrounds; `max-w-none` disables prose's default 65ch cap so it fills the chat column.

- **Font: Geist is global, no per-component override.** `body` declares `font-family: "Geist", system-ui, ...` in `index.css`. Don't set `font-sans` or `font-mono` on individual elements unless you specifically want monospace (then use `font-mono`, which falls back to Geist Mono via the system stack). Don't import Google Fonts inline — Geist is bundled.

- **Long `className` strings are fine; don't extract just for length.** A 6-line className on a heavily styled element is normal Tailwind code. Don't pull it into a `const buttonClasses = "..."` or a `clsx()` helper just because the line is long. Extract only when the same combination is reused **3+ times** across the codebase (DRY), or when conditional logic genuinely needs a builder (`clsx`/`cn`).

- **Group utilities visually.** When a className is more than ~4 utilities, group them in this order so diffs read cleanly: **layout** (`flex`, `grid`, `block`) → **box** (`w-*`, `h-*`, `p-*`, `m-*`, `gap-*`) → **color** (`bg-*`, `text-*`, `border-*`) → **typography** (`text-sm`, `font-medium`, `leading-*`) → **state/interaction** (`hover:*`, `focus:*`, `transition-*`). Not enforced by a linter — just a readability convention.

## Palette

The aesthetic is **dark monochrome** (locked in the 2026-04-27 design log entry): pure black background, zinc grayscale, no accent color, no gradients. Concretely:

- Backgrounds: `bg-zinc-950` (page), `bg-zinc-900` (panels), `bg-zinc-800` (subtle bubbles)
- Borders / dividers: `border-zinc-800`, `border-zinc-700` for hover states
- Text: `text-zinc-100` (primary), `text-zinc-400` (secondary), `text-zinc-500` (tertiary / metadata)
- The only color accents are functional dots in the memory sidebar (e.g., sky-blue for context cards) — keep those scoped.

If you find yourself reaching for `text-blue-500` or `bg-emerald-600` on a top-level element, stop and check whether it should be zinc instead.
