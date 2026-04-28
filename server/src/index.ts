import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { serve } from "@hono/node-server";

// Load .env from the project root (one level above server/)
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../../.env") });

import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import Anthropic from "@anthropic-ai/sdk";

const app = new Hono();

app.use("*", cors({ origin: "http://localhost:5173" }));

const client = new Anthropic();

const SYSTEM_PROMPT = `You are home-ai — a personal AI for the user. You are warm, direct, and concise. Answer questions, brainstorm, help with tasks, or just chat. Match the user's tone and length: terse questions get terse answers, open questions can get longer ones. Never preface with filler like "I'd be happy to help" or "Of course!". When you don't know something, say so.`;

app.post("/chat", async (c) => {
  const { messages } = await c.req.json<{ messages: Anthropic.MessageParam[] }>();

  return streamSSE(c, async (stream) => {
    try {
      const apiStream = client.messages.stream({
        model: "claude-opus-4-7",
        max_tokens: 64000,
        system: SYSTEM_PROMPT,
        messages,
      });

      for await (const event of apiStream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          await stream.writeSSE({
            data: JSON.stringify({ type: "text", delta: event.delta.text }),
          });
        }
      }

      const final = await apiStream.finalMessage();
      await stream.writeSSE({
        data: JSON.stringify({
          type: "done",
          stop_reason: final.stop_reason,
          usage: final.usage,
        }),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("Chat error:", err);
      await stream.writeSSE({ data: JSON.stringify({ type: "error", message }) });
    }
  });
});

app.get("/", (c) => c.text("home-ai server"));

const port = Number(process.env.PORT) || 3001;
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`home-ai server running on http://localhost:${info.port}`);
});
