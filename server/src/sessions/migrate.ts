import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join, basename } from "node:path";
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import type { SessionStoreEntry } from "@anthropic-ai/claude-agent-sdk";
import { sqliteSessionStore } from "./store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = resolve(__dirname, "../../..");
config({ path: resolve(PROJECT_DIR, ".env") });

// SDK's project-dir encoding observed on disk: `:`, `\`, `/`, `.` → `-`.
function encodeProjectKey(dir: string): string {
  return dir.replace(/[\\/:.]/g, "-");
}

const TARGET_PROJECT_KEY = encodeProjectKey(PROJECT_DIR);

// Source dirs to scan: project root + server workspace (where the orphaned
// sessions ended up before we set `cwd: PROJECT_DIR` in query()). Add more if
// older sessions show up under different keys.
const SOURCE_DIRS = [
  encodeProjectKey(PROJECT_DIR),
  encodeProjectKey(resolve(PROJECT_DIR, "server")),
  encodeProjectKey(resolve(PROJECT_DIR, "web")),
];

const projectsRoot = join(homedir(), ".claude", "projects");
const BATCH_SIZE = 500;

async function importJsonl(file: string, sessionId: string): Promise<number> {
  const text = readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  let batch: SessionStoreEntry[] = [];
  let total = 0;

  for (const line of lines) {
    let entry: SessionStoreEntry;
    try {
      entry = JSON.parse(line) as SessionStoreEntry;
    } catch {
      console.warn(`  skipping malformed line in ${basename(file)}`);
      continue;
    }
    batch.push(entry);
    if (batch.length >= BATCH_SIZE) {
      await sqliteSessionStore.append(
        { projectKey: TARGET_PROJECT_KEY, sessionId },
        batch,
      );
      total += batch.length;
      batch = [];
    }
  }

  if (batch.length > 0) {
    await sqliteSessionStore.append(
      { projectKey: TARGET_PROJECT_KEY, sessionId },
      batch,
    );
    total += batch.length;
  }

  return total;
}

async function run() {
  console.log(`[migrate] target projectKey: ${TARGET_PROJECT_KEY}`);

  let importedSessions = 0;
  let importedEntries = 0;
  const seenSessions = new Set<string>();

  for (const sourceKey of SOURCE_DIRS) {
    const sourceDir = join(projectsRoot, sourceKey);
    let files: string[];
    try {
      files = readdirSync(sourceDir).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    if (files.length === 0) continue;
    console.log(`[migrate] scanning ${sourceKey}: ${files.length} session file(s)`);

    for (const file of files) {
      const sessionId = basename(file, ".jsonl");
      if (seenSessions.has(sessionId)) {
        console.log(`  ${sessionId}: already imported from another source — skipping`);
        continue;
      }
      try {
        const count = await importJsonl(join(sourceDir, file), sessionId);
        seenSessions.add(sessionId);
        importedSessions += 1;
        importedEntries += count;
        console.log(`  ${sessionId}: ${count} entries`);
      } catch (err) {
        console.warn(`  ${sessionId}: failed —`, err);
      }
    }
  }

  console.log(
    `[migrate] done — ${importedSessions} sessions, ${importedEntries} entries imported.`,
  );
}

await run();
