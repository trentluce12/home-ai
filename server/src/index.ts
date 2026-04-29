import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { kgServer, KG_TOOL_NAMES } from "./kg/tools.js";
import { retrieveSubgraph } from "./kg/retrieve.js";

// Load .env from the project root (one level above server/)
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../../.env") });

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
- For personal-context questions, prefer the KG (and the auto-injected context) before reaching for the web.`;

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
        data: JSON.stringify({ type: "context", ...subgraph.summary }),
      });
    }

    try {
      for await (const message of query({
        prompt,
        options: {
          model: "claude-opus-4-7",
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

app.get("/", (c) => c.text("home-ai server"));

const port = Number(process.env.PORT) || 3001;
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`home-ai server running on http://localhost:${info.port}`);
});
