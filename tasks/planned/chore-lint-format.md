# Set up ESLint + Prettier across both workspaces

**Why:** Updated story-implementer contract gates on `npm run lint` and `npm run format:check`. Neither tool is configured today.

**What:**
- Install ESLint + plugins (`typescript-eslint`, `eslint-plugin-react`, `eslint-plugin-react-hooks`)
- Install Prettier + `eslint-config-prettier`
- `eslint.config.js` (flat config) at workspace root with overrides for server (Node) vs web (React)
- `.prettierrc.json` at workspace root
- npm scripts at root + per-workspace: `lint`, `lint:fix`, `format`, `format:check`
- Run once and fix existing issues so the gates start clean
- Update `CLAUDE.md` "Useful commands" section to mention `lint` + `format`

**Files:** `package.json`, `eslint.config.js` (new), `.prettierrc.json` (new), `server/package.json`, `web/package.json`, `CLAUDE.md`. Will touch many existing files when fixing initial issues.

**Estimate:** 1.5 hr

**Dependencies:** none

**Smoke steps:** `npm run lint` exits 0; `npm run format:check` exits 0; `npm run typecheck` still exits 0.

---

**Status:** pending
**Started:** —

## Notes
