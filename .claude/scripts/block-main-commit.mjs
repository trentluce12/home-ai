#!/usr/bin/env node
// PreToolUse hook on Bash: refuse `git commit` / `git push` while HEAD is `main`.
// Project rule: home-ai work happens on `dev-tl`. This is the harness-enforced backstop.
//
// Hook contract (Claude Code):
// - stdin: JSON payload with `tool_name` and `tool_input.command`
// - exit 0: allow the tool call
// - exit 2: block the tool call (stderr is surfaced to Claude)
//
// Cross-platform: pure Node, no shell builtins. Runs on Windows + macOS + Linux.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function parsePayload(raw) {
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function currentBranch(cwd) {
  try {
    const out = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.trim();
  } catch {
    return null;
  }
}

// Match `git commit ...` or `git push ...` anywhere in the command, allowing for
// leading env vars, `cd && ...`, or chained commands via `&&` / `;` / `|`. We err
// on the side of catching too much: a false positive just nudges a branch switch.
function matchesGitWriteCommand(command) {
  if (typeof command !== "string") return null;
  // Strip leading whitespace from each segment so `cd foo && git commit` matches.
  const segments = command.split(/(?:&&|\|\||;|\|)/);
  for (const segment of segments) {
    const trimmed = segment.trim();
    if (/^git\s+commit(\s|$)/.test(trimmed)) return "commit";
    if (/^git\s+push(\s|$)/.test(trimmed)) return "push";
  }
  return null;
}

const payload = parsePayload(readStdin());
if (!payload || payload.tool_name !== "Bash") {
  // Not for us — allow.
  process.exit(0);
}

const command = payload?.tool_input?.command;
const action = matchesGitWriteCommand(command);
if (!action) {
  process.exit(0);
}

const branch = currentBranch(payload.cwd ?? process.cwd());
if (branch !== "main") {
  process.exit(0);
}

const verb = action === "push" ? "push" : "commit";
process.stderr.write(
  `Refusing ${verb} on main. Switch to dev-tl first:\n` +
    `  git checkout dev-tl\n` +
    `(home-ai project rule: never commit or push directly to main.)\n`,
);
process.exit(2);
