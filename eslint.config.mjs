// Flat ESLint config (ESLint 9+). Covers both workspaces from the repo root.
//
// Layers:
//   1. Base recommendations from @eslint/js + typescript-eslint.
//   2. Server overrides (Node globals, no DOM).
//   3. Web overrides (React + browser globals; React Hooks rules).
//   4. eslint-config-prettier last — turns off rules that conflict with Prettier
//      formatting so the two tools don't fight.

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import prettierConfig from "eslint-config-prettier";
import globals from "globals";

export default [
  // Things ESLint should never touch.
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/node_modules/**",
      "**/*.tsbuildinfo",
      "data/**",
    ],
  },

  // Base JS recommendations.
  js.configs.recommended,

  // TypeScript recommendations — applied to all .ts/.tsx files via the plugin's
  // own file matchers.
  ...tseslint.configs.recommended,

  // ── Server (Node.js) ───────────────────────────────────────────────
  {
    files: ["server/**/*.{ts,js}"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // The server intentionally uses console for request logs / warnings.
      "no-console": "off",
    },
  },

  // ── Web (React + browser) ──────────────────────────────────────────
  {
    files: ["web/**/*.{ts,tsx}"],
    plugins: {
      react,
      "react-hooks": reactHooks,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      react: { version: "detect" },
    },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      // We use react-jsx (automatic runtime) — no React import needed in scope.
      "react/react-in-jsx-scope": "off",
      // We don't use prop-types; types come from TypeScript.
      "react/prop-types": "off",
      // Bare apostrophes/quotes in JSX text render fine in modern React; the
      // entity-escape rule trades source-string readability for marginal
      // strictness. Off project-wide.
      "react/no-unescaped-entities": "off",
    },
  },

  // ── Web config files (Node context: vite/tailwind/postcss configs) ──
  {
    files: ["web/*.{ts,js}", "web/postcss.config.js"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  // ── Harness hook scripts (.claude/scripts/*.mjs) — Node, no app code. ──
  {
    files: [".claude/scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  // Project-wide tweaks. _-prefixed unused args/vars are intentional.
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },

  // Must come last — disables formatting-related rules so Prettier owns layout.
  prettierConfig,
];
