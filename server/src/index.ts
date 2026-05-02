import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { serve } from "@hono/node-server";
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

// Load .env from the project root (one level above server/)
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = resolve(__dirname, "../..");
config({ path: resolve(PROJECT_DIR, ".env") });

const app = new Hono();
app.use("*", cors({ origin: "http://localhost:5173" }));

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

OTHER TOOLS:
- File system (Read, Write, Edit, Glob, Grep) and Bash are available for tasks involving files or shell commands.
- Web tools (WebFetch, WebSearch) for current information.
- For personal-context questions, prefer the KG (and the auto-injected context) before reaching for the web.

YOUR ACTUAL CAPABILITIES — be honest about what you can and cannot do:
- You CAN: chat with the user, read/write/search the personal KG (the tools above), read and edit files on this machine, run shell commands via Bash, fetch URLs (WebFetch), and run web searches (WebSearch).
- You CANNOT: send email, read mail, access calendars, schedule events, send notifications, control smart-home devices, run background jobs, integrate with Gmail/Calendar/Drive/Slack/Notion/Supabase or any third-party service, or take any action that isn't covered by the tools above.
- Don't claim integrations or features that aren't in the list above. If the user asks for something you can't do, say so plainly and offer the closest thing you actually can do.`;

interface ChatRequest {
  message: string;
  sessionId?: string;
}

function wrapWithContext(userText: string, contextBlock: string): string {
  if (!contextBlock) return userText;
  return `<context>\n${contextBlock}\n</context>\n\n${userText}`;
}

app.post("/chat", async (c) => {
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
          allowedTools: [
            ...KG_TOOL_NAMES,
            "Bash",
            "Read",
            "Write",
            "Edit",
            "Glob",
            "Grep",
            "WebFetch",
            "WebSearch",
          ],
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

app.get("/sessions", async (c) => {
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
        title:
          s.customTitle ?? (s.firstPrompt ? stripContext(s.firstPrompt) : s.summary),
        lastModified: s.lastModified,
        archived: archivedSet.has(s.sessionId),
      }))
      .sort((a, b) => b.lastModified - a.lastModified),
  );
});

app.get("/sessions/:id/history", async (c) => {
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

app.delete("/sessions/:id", async (c) => {
  const id = c.req.param("id");
  await deleteSession(id, { dir: PROJECT_DIR, sessionStore: sqliteSessionStore });
  return c.json({ ok: true });
});

app.patch("/sessions/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req
    .json<{ title?: string }>()
    .catch(() => ({} as { title?: string }));
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

app.get("/kg/recent", (c) => {
  const limit = Number(c.req.query("limit") ?? 20);
  return c.json(kg.recentNodes(Number.isFinite(limit) ? limit : 20));
});

app.get("/kg/recent-edges", (c) => {
  const limit = Number(c.req.query("limit") ?? 8);
  return c.json(kg.recentEdges(Number.isFinite(limit) ? limit : 8));
});

app.get("/kg/stats", (c) => c.json(kg.kgStats()));

app.get("/kg/by-name/:name", (c) => {
  const name = c.req.param("name");
  const nodes = kg.findNodesByName(name);
  const withNeighbors = nodes.map((node) => ({
    node,
    neighbors: kg.neighbors({ nodeId: node.id }),
  }));
  return c.json(withNeighbors);
});

app.get("/kg/node/:id", (c) => {
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

app.delete("/kg/node/:id", (c) => {
  const id = c.req.param("id");
  const result = kg.deleteNode(id);
  if (!result.deleted) return c.json({ error: "Node not found" }, 404);
  return c.json(result);
});

app.get("/kg/graph", (c) => {
  const nodes = db
    .prepare(`SELECT id, name, type FROM nodes`)
    .all() as { id: string; name: string; type: string }[];
  const edges = db
    .prepare(`SELECT id, from_id as fromId, to_id as toId, type FROM edges`)
    .all() as { id: string; fromId: string; toId: string; type: string }[];
  return c.json({ nodes, edges });
});

app.post("/kg/record-fact", async (c) => {
  const body = await c.req.json<{
    a: { name: string; type: string };
    b: { name: string; type: string };
    edgeType: string;
  }>().catch(() => null);
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
    kg.recordProvenance({ factId: result.a.id, factKind: "node", source: "user_statement" });
  }
  if (result.created.bCreated) {
    newNodes.push(result.b);
    kg.recordProvenance({ factId: result.b.id, factKind: "node", source: "user_statement" });
  }
  kg.recordProvenance({ factId: result.edge.id, factKind: "edge", source: "user_statement" });

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

app.get("/kg/layout", (c) => {
  return c.json(kg.getLayout());
});

app.post("/kg/layout", async (c) => {
  const body = await c
    .req.json<{ positions: { nodeId: string; x: number; y: number }[] }>()
    .catch(() => null);
  if (!body || !Array.isArray(body.positions)) {
    return c.json({ error: "positions array required" }, 400);
  }
  const valid = body.positions.filter(
    (p) =>
      typeof p.nodeId === "string" &&
      Number.isFinite(p.x) &&
      Number.isFinite(p.y),
  );
  kg.saveLayout(valid);
  return c.json({ ok: true, saved: valid.length });
});

app.get("/kg/export", (c) => {
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

app.get("/", (c) => c.text("home-ai server"));

const port = Number(process.env.PORT) || 3001;
serve({ fetch: app.fetch, port }, (info) => {
  const cleanup = cleanupSessions();
  if (cleanup.archived > 0 || cleanup.deleted > 0) {
    console.log(
      `[sessions] retention sweep: archived ${cleanup.archived} (>${cleanup.archiveDays}d), deleted ${cleanup.deleted} (>${cleanup.deleteDays}d)`,
    );
  }
  console.log(`home-ai server running on http://localhost:${info.port}`);
});
