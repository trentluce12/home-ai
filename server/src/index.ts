import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, relative, resolve } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import {
  query,
  listSessions,
  getSessionMessages,
  deleteSession,
  renameSession,
} from "@anthropic-ai/claude-agent-sdk";
import { kgServer, KG_TOOL_NAMES } from "./kg/tools.js";
import { retrieveSubgraph } from "./kg/retrieve.js";
import * as kg from "./kg/db.js";
import { embedNodes } from "./embeddings/index.js";
import { sqliteSessionStore } from "./sessions/store.js";
import { cleanupSessions } from "./sessions/cleanup.js";
import { db } from "./kg/db.js";
import { authRoutes } from "./routes/auth.js";
import { requireAuth } from "./auth/middleware.js";

// Load .env from the project root (one level above server/)
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = resolve(__dirname, "../..");
config({ path: resolve(PROJECT_DIR, ".env") });

const app = new Hono();
// In production the SPA is served from the same origin as the API (see
// `m45-static-serving`), so CORS is unnecessary. In dev, Vite runs on
// :5173 and the server on :3001, so we still need it.
if (process.env.NODE_ENV !== "production") {
  app.use(
    "*",
    cors({
      origin: "http://localhost:5173",
      // Browser must be allowed to send/receive the session cookie cross-origin
      // in dev (vite :5173 → server :3001). In prod the SPA is served from the
      // same origin, so no CORS at all.
      credentials: true,
    }),
  );
}

// Gate all `/api/*` routes behind a session check. The middleware itself
// allows `/api/auth/*` through unauthenticated — login can't require a
// prior login — so the order vs. `app.route("/api/auth", ...)` below is
// not load-bearing, but registering the middleware first matches Hono's
// top-to-bottom convention for path-level handlers.
app.use("/api/*", requireAuth);

app.route("/api/auth", authRoutes);

// Tool narrowing for production safety. By default we exclude Bash/Write/Edit
// — chat usage doesn't exercise them day-to-day, and dropping them shrinks the
// blast radius of an auth bypass from "execute arbitrary shell" to "read files
// + browse the web". Set `HOME_AI_ALLOW_WRITE_TOOLS=true` to opt back in for
// local-dev workflows where the model genuinely needs to edit files / run
// commands.
const ALLOW_WRITE_TOOLS = process.env.HOME_AI_ALLOW_WRITE_TOOLS === "true";
const ALLOWED_TOOLS: string[] = [
  ...KG_TOOL_NAMES,
  "Read",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
  ...(ALLOW_WRITE_TOOLS ? ["Bash", "Write", "Edit"] : []),
];

const SYSTEM_PROMPT = `You are home-ai — a personal AI for the user. You are warm, direct, and concise. Match the user's tone and length: terse questions get terse answers, open questions can get longer ones. Never preface with filler like "I'd be happy to help" or "Of course!". When you don't know something, say so.

You have a personal knowledge graph (KG) that persists across conversations — it's how you remember facts about the user's life: people they know, places they live or visit, devices they own, projects, events, preferences, documents, topics, organizations, pets.

ENTITY TYPES (the \`type\` field on nodes): Person, Place, Device, Project, Task, Event, Preference, Document, Topic, Organization, Pet.

EDGE TYPES (the \`type\` field on edges): KNOWS, LIVES_WITH, WORKS_AT, OWNS, LOCATED_IN, PART_OF, RELATES_TO, SCHEDULED_FOR, ASSIGNED_TO, PREFERS, DEPENDS_ON, MENTIONED_IN.

THE USER'S NODE: A node with name "user" and type Person represents the user themselves. Most facts they share are about themselves, so most edges go from "user" → something. Create the user node on demand if it doesn't exist (the recording tools handle this).

PASSIVE CONTEXT: Before each user turn, relevant facts from your KG are auto-injected as a <context> block before the user's message. Trust this context as the current state of memory and answer from it directly when it covers the question — no tool call needed. Only reach for \`search\` if the context block looks insufficient.

RECORDING FACTS — two distinct tools:

1. \`record_user_fact\` (high confidence) — use when the user DIRECTLY STATES something. The fact is asserted by them, so we trust it.
   - "I have a dog named Snickers" → a={nameOrId:'user',type:'Person'}, b={nameOrId:'Snickers',type:'Pet'}, edgeType:'OWNS'
   - "I work at Acme" → user → Acme (Organization), edgeType:'WORKS_AT'
   - "My favorite color is blue" → user → "blue" (Preference), edgeType:'PREFERS'

2. \`record_inferred_fact\` (lower confidence) — use ONLY when you derived a fact from context that the user did not directly state. Default confidence 0.5; raise it (toward 0.9) for near-certain inferences. Use this sparingly — most facts should come through \`record_user_fact\`.
   - User mentions "my walk with Snickers this morning" — already known they own Snickers, no inference needed.
   - User says "I've been thinking of taking Snickers to the vet" — inferring Snickers is sick is speculation; don't record.
   - User describes a pattern across turns ("I keep forgetting to take my meds") — inferred Preference about a habit could be recorded with low confidence.

When in doubt, prefer \`record_user_fact\`. Don't ask permission. Don't over-record idle remarks ("I've been tired"); record clear assertions.

OBSIDIAN VAULT IMPORT: If the user asks you to import facts from an Obsidian vault (or types \`/import-obsidian <path>\` as a chat message), do a one-off bulk ingestion:

1. Use \`Glob\` with pattern \`**/*.md\` rooted at the path the user provided to enumerate every note. Skip the vault's \`.obsidian/\` config dir and any \`.trash/\` folder.
2. For each note, use \`Read\` to load it. Treat the filename (sans \`.md\`) as a candidate entity name; treat \`#tags\`, \`[[wiki-links]]\`, and YAML frontmatter as relationship hints. Only extract facts that are clearly about the user or their world — biographical sentences, ownership ("my dog X"), employer, location, preferences, projects. Skip generic notes (recipes, meeting notes about strangers, code snippets) — those aren't personal-context facts.
3. **Idempotency is critical.** Before each \`record_user_fact\`, call \`mcp__kg__search\` for the target node by name (and type if obvious). If a node with the same \`(name, type)\` already exists, the underlying \`link\` already dedupes the node — but it does NOT dedupe edges. So before recording the same edge twice (e.g., \`user OWNS Snickers\`), call \`mcp__kg__neighbors\` on the source node and check whether an edge of the same type to a node with the same name already exists. Skip if so. Re-running the import over the same vault must not duplicate facts.
4. Batch-report progress as you go (every ~10 notes processed, summarize: "Read 10 notes, recorded 4 new facts, skipped 6 as duplicates or non-personal"). After the full pass, give a final tally and surface anything ambiguous you skipped so the user can clarify.
5. If the path doesn't exist or contains no \`.md\` files, say so plainly and stop — don't fabricate content.

This is a deliberate, slow flow — extracting personal facts from prose is judgement-heavy and you should err on the side of skipping rather than recording a guess. \`record_inferred_fact\` is generally NOT appropriate here; the user invoked the import explicitly so anything you record is implicitly under their authority, and \`record_user_fact\` is the right tool. Use \`record_inferred_fact\` only if the note prose itself flags something as a guess ("I think...", "probably...").

OTHER TOOLS:
${
  ALLOW_WRITE_TOOLS
    ? `- File system (Read, Write, Edit, Glob, Grep) and Bash are available for tasks involving files or shell commands.`
    : `- File system (Read, Glob, Grep) for searching and reading files. You cannot write or edit files, and Bash/shell commands are not available.`
}
- Web tools (WebFetch, WebSearch) for current information.
- For personal-context questions, prefer the KG (and the auto-injected context) before reaching for the web.

YOUR ACTUAL CAPABILITIES — be honest about what you can and cannot do:
- You CAN: chat with the user, read/write/search the personal KG (the tools above), ${
  ALLOW_WRITE_TOOLS
    ? "read and edit files on this machine, run shell commands via Bash, "
    : "read files on this machine (read-only — no editing or shell access), "
}fetch URLs (WebFetch), and run web searches (WebSearch).
- You CANNOT: ${
  ALLOW_WRITE_TOOLS ? "" : "edit/write files, run shell commands, "
}send email, read mail, access calendars, schedule events, send notifications, control smart-home devices, run background jobs, integrate with Gmail/Calendar/Drive/Slack/Notion/Supabase or any third-party service, or take any action that isn't covered by the tools above.
- Don't claim integrations or features that aren't in the list above. If the user asks for something you can't do, say so plainly and offer the closest thing you actually can do.`;

interface ChatRequest {
  message: string;
  sessionId?: string;
}

function wrapWithContext(userText: string, contextBlock: string): string {
  if (!contextBlock) return userText;
  return `<context>\n${contextBlock}\n</context>\n\n${userText}`;
}

app.post("/api/chat", async (c) => {
  const body = await c.req.json<ChatRequest>();
  const userText = body.message?.trim();
  if (!userText) {
    return c.json({ error: "Missing message" }, 400);
  }

  const subgraph = await retrieveSubgraph(userText);
  const prompt = wrapWithContext(userText, subgraph.formatted);

  return streamSSE(c, async (stream) => {
    if (subgraph.summary.edgeCount > 0 || subgraph.summary.nodeCount > 0) {
      await stream.writeSSE({
        data: JSON.stringify({
          type: "context",
          ...subgraph.summary,
          formatted: subgraph.formatted,
        }),
      });
    }

    try {
      for await (const message of query({
        prompt,
        options: {
          model: "claude-opus-4-7",
          cwd: PROJECT_DIR,
          sessionStore: sqliteSessionStore,
          systemPrompt: SYSTEM_PROMPT,
          permissionMode: "bypassPermissions",
          mcpServers: { kg: kgServer },
          allowedTools: ALLOWED_TOOLS,
          includePartialMessages: true,
          ...(body.sessionId ? { resume: body.sessionId } : {}),
        },
      })) {
        const m = message as Record<string, unknown> & { type: string };

        switch (m.type) {
          case "system": {
            if (m.subtype === "init" && typeof m.session_id === "string") {
              await stream.writeSSE({
                data: JSON.stringify({ type: "session", id: m.session_id }),
              });
            }
            break;
          }
          case "stream_event": {
            // Token-by-token text. Tool_use input deltas are skipped here —
            // the final assistant message carries complete tool_use blocks.
            const ev = m.event as
              | {
                  type: string;
                  delta?: { type: string; text?: string };
                }
              | undefined;
            if (
              ev?.type === "content_block_delta" &&
              ev.delta?.type === "text_delta" &&
              typeof ev.delta.text === "string"
            ) {
              await stream.writeSSE({
                data: JSON.stringify({ type: "text", delta: ev.delta.text }),
              });
            }
            break;
          }
          case "assistant": {
            // Text already streamed via stream_event above. Forward tool_use
            // blocks for the sidebar.
            const inner = m.message as { content?: unknown[] } | undefined;
            const content = inner?.content ?? [];
            for (const blockRaw of content) {
              const block = blockRaw as Record<string, unknown> & { type: string };
              if (block.type === "tool_use") {
                await stream.writeSSE({
                  data: JSON.stringify({
                    type: "tool_use",
                    id: block.id,
                    name: block.name,
                    input: block.input,
                  }),
                });
              }
            }
            break;
          }
          case "result": {
            const usage = m.usage as
              | {
                  input_tokens?: number;
                  output_tokens?: number;
                  cache_creation_input_tokens?: number;
                  cache_read_input_tokens?: number;
                }
              | undefined;
            if (usage) {
              const created = usage.cache_creation_input_tokens ?? 0;
              const read = usage.cache_read_input_tokens ?? 0;
              const input = usage.input_tokens ?? 0;
              const output = usage.output_tokens ?? 0;
              console.log(
                `[chat] tokens: in=${input} out=${output} cache_create=${created} cache_read=${read}`,
              );
            }
            await stream.writeSSE({
              data: JSON.stringify({
                type: "done",
                success: m.subtype === "success",
                totalCostUsd: m.total_cost_usd,
                usage,
              }),
            });

            // Smart title side-call (background, doesn't block stream).
            const sid = typeof m.session_id === "string" ? m.session_id : null;
            if (sid && m.subtype === "success") {
              maybeSmartTitle(sid).catch((err) =>
                console.warn("[smart-title]", err instanceof Error ? err.message : err),
              );
            }
            break;
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.error("Chat error:", err);
      await stream.writeSSE({ data: JSON.stringify({ type: "error", message: msg }) });
    }
  });
});

// ───────── Smart titling ─────────

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const SMART_TITLE_MIN_USER_TURNS = 2;
const SMART_TITLE_MODEL = "claude-haiku-4-5-20251001";
const titledSessions = new Set<string>();

async function maybeSmartTitle(sessionId: string): Promise<void> {
  if (titledSessions.has(sessionId)) return;

  const sessions = await listSessions({
    dir: PROJECT_DIR,
    sessionStore: sqliteSessionStore,
    includeWorktrees: false,
  });
  const info = sessions.find((s) => s.sessionId === sessionId);
  if (!info) return;
  if (info.customTitle) {
    titledSessions.add(sessionId);
    return;
  }

  const messages = await getSessionMessages(sessionId, {
    dir: PROJECT_DIR,
    sessionStore: sqliteSessionStore,
  });
  const turns: { role: "user" | "assistant"; content: string }[] = [];
  for (const msg of messages) {
    if (msg.type !== "user" && msg.type !== "assistant") continue;
    const text = extractText(msg.message);
    if (!text) continue;
    turns.push({
      role: msg.type,
      content: msg.type === "user" ? stripContext(text) : text,
    });
  }
  const userTurns = turns.filter((t) => t.role === "user").length;
  if (userTurns < SMART_TITLE_MIN_USER_TURNS) return;

  // Mark before the API call so concurrent turns don't double-fire.
  titledSessions.add(sessionId);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("[smart-title] ANTHROPIC_API_KEY not set, skipping");
    return;
  }

  const transcript = turns
    .slice(0, 6)
    .map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.content.slice(0, 400)}`)
    .join("\n\n");

  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: SMART_TITLE_MODEL,
      max_tokens: 32,
      messages: [
        {
          role: "user",
          content: `Summarize this conversation as a title in 4-6 words. Reply with the title only — no quotes, no punctuation, no preamble.\n\n${transcript}`,
        },
      ],
    }),
  });
  if (!res.ok) {
    titledSessions.delete(sessionId);
    throw new Error(`Title API ${res.status}`);
  }
  const json = (await res.json()) as {
    content?: { type: string; text?: string }[];
  };
  const title = (json.content?.find((c) => c.type === "text")?.text ?? "")
    .trim()
    .replace(/^["'`]|["'`]$/g, "")
    .replace(/\.$/, "")
    .slice(0, 80);
  if (!title) return;

  await renameSession(sessionId, title, {
    dir: PROJECT_DIR,
    sessionStore: sqliteSessionStore,
  });
}

// ───────── Sessions ─────────

const CONTEXT_PREFIX = /^<context>[\s\S]*?<\/context>\n\n/;
const stripContext = (s: string): string => s.replace(CONTEXT_PREFIX, "");

function extractText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const m = message as { content?: unknown };
  const content = m.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (b): b is { type: "text"; text: string } =>
        b !== null &&
        typeof b === "object" &&
        (b as { type?: unknown }).type === "text" &&
        typeof (b as { text?: unknown }).text === "string",
    )
    .map((b) => b.text)
    .join("");
}

app.get("/api/sessions", async (c) => {
  const includeArchived = c.req.query("includeArchived") === "true";
  const sessions = await listSessions({
    dir: PROJECT_DIR,
    sessionStore: sqliteSessionStore,
    includeWorktrees: false,
  });

  const archivedRows = db
    .prepare(`SELECT session_id FROM sessions WHERE archived_at IS NOT NULL`)
    .all() as { session_id: string }[];
  const archivedSet = new Set(archivedRows.map((r) => r.session_id));

  return c.json(
    sessions
      .filter((s) => includeArchived || !archivedSet.has(s.sessionId))
      .map((s) => ({
        id: s.sessionId,
        title: s.customTitle ?? (s.firstPrompt ? stripContext(s.firstPrompt) : s.summary),
        lastModified: s.lastModified,
        archived: archivedSet.has(s.sessionId),
      }))
      .sort((a, b) => b.lastModified - a.lastModified),
  );
});

app.get("/api/sessions/:id/history", async (c) => {
  const id = c.req.param("id");
  const messages = await getSessionMessages(id, {
    dir: PROJECT_DIR,
    sessionStore: sqliteSessionStore,
  });
  const turns: { role: "user" | "assistant"; content: string }[] = [];
  for (const msg of messages) {
    if (msg.type !== "user" && msg.type !== "assistant") continue;
    const text = extractText(msg.message);
    if (!text) continue;
    turns.push({
      role: msg.type,
      content: msg.type === "user" ? stripContext(text) : text,
    });
  }
  return c.json(turns);
});

app.delete("/api/sessions/:id", async (c) => {
  const id = c.req.param("id");
  await deleteSession(id, { dir: PROJECT_DIR, sessionStore: sqliteSessionStore });
  return c.json({ ok: true });
});

app.patch("/api/sessions/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req
    .json<{ title?: string }>()
    .catch(() => ({}) as { title?: string });
  const title = body.title?.trim();
  if (!title) return c.json({ error: "title required" }, 400);
  if (title.length > 200) return c.json({ error: "title too long" }, 400);
  await renameSession(id, title, {
    dir: PROJECT_DIR,
    sessionStore: sqliteSessionStore,
  });
  titledSessions.add(id);
  return c.json({ ok: true, title });
});

// ───────── KG (slash commands) ─────────

app.get("/api/kg/recent", (c) => {
  const limit = Number(c.req.query("limit") ?? 20);
  return c.json(kg.recentNodes(Number.isFinite(limit) ? limit : 20));
});

app.get("/api/kg/recent-edges", (c) => {
  const limit = Number(c.req.query("limit") ?? 8);
  return c.json(kg.recentEdges(Number.isFinite(limit) ? limit : 8));
});

app.get("/api/kg/stats", (c) => c.json(kg.kgStats()));

app.get("/api/kg/by-name/:name", (c) => {
  const name = c.req.param("name");
  const nodes = kg.findNodesByName(name);
  const withNeighbors = nodes.map((node) => ({
    node,
    neighbors: kg.neighbors({ nodeId: node.id }),
  }));
  return c.json(withNeighbors);
});

app.get("/api/kg/node/:id", (c) => {
  const id = c.req.param("id");
  const node = kg.getNode(id);
  if (!node) return c.json({ error: "Node not found" }, 404);
  const neighbors = kg.neighbors({ nodeId: id });
  const provenance = db
    .prepare(
      `SELECT source, source_ref as sourceRef, created_at as createdAt
       FROM provenance WHERE fact_id = ? AND fact_kind = 'node'
       ORDER BY created_at DESC`,
    )
    .all(id) as { source: string; sourceRef: string | null; createdAt: number }[];
  return c.json({ node, neighbors, provenance });
});

app.delete("/api/kg/node/:id", (c) => {
  const id = c.req.param("id");
  const result = kg.deleteNode(id);
  if (!result.deleted) return c.json({ error: "Node not found" }, 404);
  return c.json(result);
});

// ───────── Node notes (M5 phase 1) ─────────
//
// 1:1 free-form markdown attached to a KG node. `node_notes` cascades on node
// delete so `forget` cleans up automatically (no app-level cleanup needed).
// PUT body is empty → treat as delete; the editor uses save-on-blur and an
// empty body shouldn't leave an empty row behind.

app.get("/api/kg/node/:id/note", (c) => {
  const id = c.req.param("id");
  if (!kg.getNode(id)) return c.json({ error: "Node not found" }, 404);
  const note = kg.getNote(id);
  return c.json({ note });
});

app.put("/api/kg/node/:id/note", async (c) => {
  const id = c.req.param("id");
  if (!kg.getNode(id)) return c.json({ error: "Node not found" }, 404);
  const body = await c.req.json<{ body?: unknown }>().catch(() => null);
  if (!body || typeof body.body !== "string") {
    return c.json({ error: "body (string) required" }, 400);
  }
  const trimmed = body.body.trim();
  if (trimmed.length === 0) {
    kg.deleteNote(id);
    return c.json({ note: null });
  }
  const note = kg.setNote(id, body.body);
  return c.json({ note });
});

app.delete("/api/kg/node/:id/note", (c) => {
  const id = c.req.param("id");
  if (!kg.getNode(id)) return c.json({ error: "Node not found" }, 404);
  const result = kg.deleteNote(id);
  return c.json(result);
});

app.get("/api/kg/graph", (c) => {
  const nodes = db.prepare(`SELECT id, name, type FROM nodes`).all() as {
    id: string;
    name: string;
    type: string;
  }[];
  const edges = db
    .prepare(`SELECT id, from_id as fromId, to_id as toId, type FROM edges`)
    .all() as { id: string; fromId: string; toId: string; type: string }[];
  return c.json({ nodes, edges });
});

app.post("/api/kg/record-fact", async (c) => {
  const body = await c.req
    .json<{
      a: { name: string; type: string };
      b: { name: string; type: string };
      edgeType: string;
    }>()
    .catch(() => null);
  if (!body) return c.json({ error: "invalid JSON" }, 400);
  const aName = body.a?.name?.trim();
  const bName = body.b?.name?.trim();
  const aType = body.a?.type;
  const bType = body.b?.type;
  const edgeType = body.edgeType;
  if (!aName || !bName || !aType || !bType || !edgeType) {
    return c.json({ error: "a.name, a.type, b.name, b.type, edgeType required" }, 400);
  }
  if (!kg.NODE_TYPES.includes(aType as (typeof kg.NODE_TYPES)[number])) {
    return c.json({ error: `invalid a.type "${aType}"` }, 400);
  }
  if (!kg.NODE_TYPES.includes(bType as (typeof kg.NODE_TYPES)[number])) {
    return c.json({ error: `invalid b.type "${bType}"` }, 400);
  }
  if (!kg.EDGE_TYPES.includes(edgeType as (typeof kg.EDGE_TYPES)[number])) {
    return c.json({ error: `invalid edgeType "${edgeType}"` }, 400);
  }

  const result = kg.link({
    a: { nameOrId: aName, type: aType },
    b: { nameOrId: bName, type: bType },
    edgeType,
    confidence: 1.0,
  });

  const newNodes: kg.Node[] = [];
  if (result.created.aCreated) {
    newNodes.push(result.a);
    kg.recordProvenance({
      factId: result.a.id,
      factKind: "node",
      source: "user_statement",
    });
  }
  if (result.created.bCreated) {
    newNodes.push(result.b);
    kg.recordProvenance({
      factId: result.b.id,
      factKind: "node",
      source: "user_statement",
    });
  }
  kg.recordProvenance({
    factId: result.edge.id,
    factKind: "edge",
    source: "user_statement",
  });

  if (newNodes.length > 0) {
    embedNodes(newNodes).catch((err) =>
      console.warn("[record-fact] embedding failed:", err),
    );
  }

  return c.json({
    ok: true,
    edge: result.edge,
    a: result.a,
    b: result.b,
    created: result.created,
  });
});

app.get("/api/kg/layout", (c) => {
  return c.json(kg.getLayout());
});

app.post("/api/kg/layout", async (c) => {
  const body = await c.req
    .json<{ positions: { nodeId: string; x: number; y: number }[] }>()
    .catch(() => null);
  if (!body || !Array.isArray(body.positions)) {
    return c.json({ error: "positions array required" }, 400);
  }
  const valid = body.positions.filter(
    (p) => typeof p.nodeId === "string" && Number.isFinite(p.x) && Number.isFinite(p.y),
  );
  kg.saveLayout(valid);
  return c.json({ ok: true, saved: valid.length });
});

app.get("/api/kg/export", (c) => {
  const format = c.req.query("format") ?? "json";
  if (format === "dot") {
    return c.body(kg.exportKgDot(), 200, {
      "Content-Type": "text/vnd.graphviz",
      "Content-Disposition": `attachment; filename="kg-${Date.now()}.dot"`,
    });
  }
  return c.body(JSON.stringify(kg.exportKg(), null, 2), 200, {
    "Content-Type": "application/json",
    "Content-Disposition": `attachment; filename="kg-${Date.now()}.json"`,
  });
});

// Round-trip companion to the JSON export. Accepts the export shape (minus
// embeddings — those get regenerated below) and a `replaceAll` flag; default
// strategy skips nodes whose (name, type) pair already exists. The actual
// insert happens inside a single transaction in `importKg`, so a malformed
// row anywhere in the body rolls the whole thing back.
//
// We intentionally do NOT validate every field tightly — the import shape is
// internal (we produced the file ourselves at /export), and overly strict
// validation would reject hand-edited backups for trivial reasons. Minimal
// shape check + transactional insert is the right tradeoff: a bad row blows
// up the SQL, the tx rolls back, the caller sees the error string.
app.post("/api/kg/import", async (c) => {
  const body = await c.req
    .json<{
      nodes?: unknown;
      edges?: unknown;
      replaceAll?: unknown;
    }>()
    .catch(() => null);
  if (!body) return c.json({ error: "invalid JSON" }, 400);
  if (!Array.isArray(body.nodes) || !Array.isArray(body.edges)) {
    return c.json({ error: "nodes and edges must be arrays" }, 400);
  }
  const replaceAll = body.replaceAll === true;

  let result: kg.KgImportResult;
  try {
    result = kg.importKg(
      { nodes: body.nodes as kg.Node[], edges: body.edges as kg.Edge[] },
      { replaceAll },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[import] failed:", err);
    return c.json({ error: `import failed: ${msg}` }, 400);
  }

  // Re-embed in the background so the response isn't gated on Voyage. Failure
  // is non-fatal — same posture as record-fact: FTS still works, hybrid
  // retrieval just skips the cosine pass for unembedded nodes until a future
  // re-embed run catches them.
  if (result.insertedNodes.length > 0) {
    embedNodes(result.insertedNodes).catch((err) =>
      console.warn("[import] embedding failed:", err),
    );
  }

  return c.json({
    ok: true,
    nodesInserted: result.nodesInserted,
    nodesSkipped: result.nodesSkipped,
    edgesInserted: result.edgesInserted,
    edgesSkipped: result.edgesSkipped,
    replaceAll,
  });
});

// ───────── Static SPA serving ─────────
//
// In single-origin prod, Hono serves the built web bundle at `/` (and its
// asset paths). This MUST be mounted after every `/api/*` route above so
// Hono's top-to-bottom matcher hits the API handlers first — otherwise the
// static catch-all would shadow them.
//
// `serveStatic`'s `root` is resolved relative to `process.cwd()` (absolute
// paths are explicitly unsupported per the upstream README). cwd differs
// between dev (`server/` — npm workspaces cd into the workspace dir) and
// prod (the container root, where the Dockerfile's `node server/dist/index.js`
// entrypoint runs). Computing the path via `path.relative` against the
// already-resolved `PROJECT_DIR` makes both work without a side-effecting
// `process.chdir`.
//
// Missing `web/dist` (i.e. `vite build` hasn't run yet in dev) is non-fatal —
// `serveStatic` logs a warning at startup and 404s on each request, which
// then falls through to the SPA fallback below; that 404s too. Acceptable in
// dev where the SPA is served by Vite on :5173 anyway.
const WEB_DIST_DIR = resolve(PROJECT_DIR, "web/dist");
const WEB_DIST_RELATIVE = relative(process.cwd(), WEB_DIST_DIR) || ".";
const WEB_DIST_INDEX_RELATIVE = relative(
  process.cwd(),
  resolve(WEB_DIST_DIR, "index.html"),
);

app.use("*", serveStatic({ root: WEB_DIST_RELATIVE }));
// SPA fallback: any non-`/api/*` path that didn't match a real file gets
// `index.html`, so client-side routes (e.g. `/login`) hydrate correctly.
// Explicitly skip `/api/*` — an authed request to a non-existent API route
// should 404, not silently swallow the path and return the SPA.
app.get("*", async (c, next) => {
  if (c.req.path.startsWith("/api/")) return next();
  return serveStatic({ path: WEB_DIST_INDEX_RELATIVE })(c, next);
});

const port = Number(process.env.PORT) || 3001;
serve({ fetch: app.fetch, port }, (info) => {
  const cleanup = cleanupSessions();
  if (cleanup.archived > 0 || cleanup.deleted > 0) {
    console.log(
      `[sessions] retention sweep: archived ${cleanup.archived} (>${cleanup.archiveDays}d), deleted ${cleanup.deleted} (>${cleanup.deleteDays}d)`,
    );
  }
  console.log(`home-ai server running on http://localhost:${info.port}`);
  console.log(
    `[tools] allowedTools: ${ALLOWED_TOOLS.join(", ")} (HOME_AI_ALLOW_WRITE_TOOLS=${ALLOW_WRITE_TOOLS})`,
  );
});
