# Default `allowedTools` drops Bash/Write/Edit

**Why:** Production default should be safe. Chat usage of home-ai doesn't exercise Bash/Write/Edit day-to-day; they're leftover from local-dev habits. Removing them shrinks the blast radius of an auth bypass from "execute arbitrary shell" to "read files in the container + browse the web."

**What:** Default `allowedTools` array in `query()` excludes `Bash`, `Write`, `Edit`. Keep `Read`, `Glob`, `Grep`, `WebFetch`, `WebSearch`, all `mcp__kg__*`. Opt back in via `HOME_AI_ALLOW_WRITE_TOOLS=true` env. Document the env var in the deploy README task (`m45-deploy-readme`).

**Files:** `server/src/index.ts`

**Estimate:** TBD
