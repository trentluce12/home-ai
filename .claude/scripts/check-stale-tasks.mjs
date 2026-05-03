#!/usr/bin/env node
// SessionStart hook: surface tasks in tasks/in-progress/ older than 1 hour.
// These are likely orphans from crashed agents or interrupted sessions —
// the user can /task-revert them or resume.
//
// Hook contract (Claude Code):
// - stdin: JSON payload (SessionStart event); we don't need it but read+ignore.
// - exit 0: clean (no warnings, or warnings printed to stderr).
// - exit non-zero: stderr is logged but does NOT crash the session.
//   We still try to exit 0 on success — failure semantics here are "warn loudly,
//   don't break" per area-4 of the .claude/ design.
//
// Cross-platform: pure Node, no shell builtins. Runs on Windows + macOS + Linux.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const STALE_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

// Resolve project root from this script's location: .claude/scripts/check-stale-tasks.mjs
// → ../../  is the repo root.
const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptDir, "..", "..");
const inProgressDir = join(projectRoot, "tasks", "in-progress");

// Drain stdin without blocking — payload is unused but the harness writes one.
try {
  readFileSync(0, "utf8");
} catch {
  // ignore
}

function listInProgress() {
  try {
    return readdirSync(inProgressDir).filter((f) => f.endsWith(".md"));
  } catch {
    // No tasks/in-progress directory at all → nothing to warn about.
    return [];
  }
}

// Parse `**Started:** <value>` from the agent-managed section of a task file.
// Returns:
//   - { kind: "missing" } if the field is absent or its value is `—` / blank.
//   - { kind: "unparseable", raw } if present but not a valid date.
//   - { kind: "parsed", date } on success.
function parseStarted(content) {
  const match = content.match(/^\*\*Started:\*\*\s*(.+?)\s*$/m);
  if (!match) return { kind: "missing" };
  const raw = match[1].trim();
  if (!raw || raw === "—" || raw === "-") return { kind: "missing" };
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return { kind: "unparseable", raw };
  return { kind: "parsed", date: new Date(ms) };
}

function formatAge(ms) {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const remMin = minutes % 60;
    return remMin > 0 ? `${hours}h${remMin}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d${remHours}h` : `${days}d`;
}

const now = Date.now();
const stale = [];

for (const file of listInProgress()) {
  const slug = file.replace(/\.md$/, "");
  const path = join(inProgressDir, file);
  let content;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    // Couldn't read — skip silently rather than crash the hook.
    continue;
  }

  const started = parseStarted(content);

  if (started.kind === "parsed") {
    const ageMs = now - started.date.getTime();
    if (ageMs >= STALE_THRESHOLD_MS) {
      stale.push({ slug, reason: `started ${formatAge(ageMs)} ago` });
    }
    continue;
  }

  // No usable Started timestamp. Fall back to file mtime so we still surface
  // genuinely-old orphans whose task file predates the agent-managed section.
  let mtimeMs;
  try {
    mtimeMs = statSync(path).mtimeMs;
  } catch {
    continue;
  }
  const ageMs = now - mtimeMs;
  if (ageMs >= STALE_THRESHOLD_MS) {
    const detail =
      started.kind === "unparseable"
        ? `Started: "${started.raw}" (unparseable)`
        : "no Started timestamp";
    stale.push({
      slug,
      reason: `${detail}; file mtime ${formatAge(ageMs)} ago`,
    });
  }
}

if (stale.length > 0) {
  const lines = [
    `Stale in-progress task${stale.length === 1 ? "" : "s"} detected (>1h old — likely orphan${stale.length === 1 ? "" : "s"}):`,
    ...stale.map(({ slug, reason }) => `  - ${slug} (${reason})`),
    "Run /task-revert <slug> to move back to planned/, or resume the work.",
  ];
  process.stderr.write(lines.join("\n") + "\n");
}

process.exit(0);
