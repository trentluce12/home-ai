import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import * as kg from "./db.js";
import { embedNode, embedNodes } from "../embeddings/index.js";
import { requestApproval } from "../approval.js";

async function recordFact(input: {
  a: { nameOrId: string; type?: string };
  b: { nameOrId: string; type?: string };
  edgeType: string;
  edgeProps?: Record<string, unknown>;
  source: kg.FactSource;
  confidence: number;
}) {
  const result = kg.link({
    a: input.a,
    b: input.b,
    edgeType: input.edgeType,
    edgeProps: input.edgeProps,
    confidence: input.confidence,
  });

  const newNodes: kg.Node[] = [];
  if (result.created.aCreated) {
    newNodes.push(result.a);
    kg.recordProvenance({ factId: result.a.id, factKind: "node", source: input.source });
  }
  if (result.created.bCreated) {
    newNodes.push(result.b);
    kg.recordProvenance({ factId: result.b.id, factKind: "node", source: input.source });
  }
  kg.recordProvenance({ factId: result.edge.id, factKind: "edge", source: input.source });

  if (newNodes.length > 0) {
    try {
      await embedNodes(newNodes);
    } catch (err) {
      // Non-fatal — FTS still works; hybrid retrieval skips this node on the
      // cosine pass until an embedding exists.
      console.warn("Embedding failed for new nodes:", err);
    }
  }

  return result;
}

const factShape = {
  a: z.object({
    nameOrId: z.string(),
    type: z.string().optional().describe("Required if the node may not exist yet"),
  }),
  b: z.object({
    nameOrId: z.string(),
    type: z.string().optional(),
  }),
  edgeType: z.string(),
  edgeProps: z.record(z.string(), z.unknown()).optional(),
};

const searchTool = tool(
  "search",
  "Full-text search over the knowledge graph. Returns matching nodes (Person, Place, Device, etc.). Use only when the auto-injected <context> block looks insufficient.",
  {
    query: z
      .string()
      .describe("Search query — matched against node names and properties"),
    types: z.array(z.string()).optional().describe("Filter by entity types"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe("Max results (default 10)"),
  },
  async (args) => {
    const results = kg.search({
      query: args.query,
      types: args.types,
      limit: args.limit,
    });
    return {
      content: [
        {
          type: "text",
          text: results.length > 0 ? JSON.stringify(results, null, 2) : "No matches.",
        },
      ],
    };
  },
);

const getTool = tool(
  "get",
  "Get a node by its ID, optionally with its 1-hop neighborhood.",
  {
    id: z.string().describe("Node ID (starts with 'node_')"),
    withNeighbors: z
      .boolean()
      .optional()
      .describe("Include 1-hop neighbors (default false)"),
  },
  async (args) => {
    const node = kg.getNode(args.id);
    if (!node) {
      return { content: [{ type: "text", text: `Node ${args.id} not found.` }] };
    }
    const result: Record<string, unknown> = { node };
    if (args.withNeighbors) {
      result.neighbors = kg.neighbors({ nodeId: args.id });
    }
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

const neighborsTool = tool(
  "neighbors",
  "List nodes connected to a given node, optionally filtered by edge type and direction.",
  {
    nodeId: z.string(),
    edgeTypes: z.array(z.string()).optional(),
    direction: z.enum(["in", "out", "both"]).optional().describe("Default 'both'"),
  },
  async (args) => {
    const items = kg.neighbors({
      nodeId: args.nodeId,
      edgeTypes: args.edgeTypes,
      direction: args.direction,
    });
    return { content: [{ type: "text", text: JSON.stringify(items, null, 2) }] };
  },
);

const recordUserFactTool = tool(
  "record_user_fact",
  "Record a fact the user directly stated. High confidence (1.0) — use this whenever the user makes a clear assertion about themselves, their life, their preferences, or their relationships. Examples: \"I have a dog named Snickers\" → a={nameOrId:'user',type:'Person'}, b={nameOrId:'Snickers',type:'Pet'}, edgeType:'OWNS'.",
  factShape,
  async (args) => {
    const result = await recordFact({
      ...args,
      source: "user_statement",
      confidence: 1.0,
    });
    const summary = `${result.a.type} "${result.a.name}" -[${result.edge.type}]-> ${result.b.type} "${result.b.name}"`;
    const noteA = result.created.aCreated ? ` (new: ${result.a.id})` : "";
    const noteB = result.created.bCreated ? ` (new: ${result.b.id})` : "";
    return {
      content: [
        { type: "text", text: `Recorded (user-stated): ${summary}${noteA}${noteB}` },
      ],
    };
  },
);

const recordInferredFactTool = tool(
  "record_inferred_fact",
  "Record a fact you inferred from context (NOT directly stated by the user). Lower default confidence (0.5). Use sparingly — only when the inference is clear and useful for future recall. Most facts should come through `record_user_fact` instead.",
  {
    ...factShape,
    confidence: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("0–1, default 0.5. Higher when the inference is near-certain."),
  },
  async (args) => {
    const result = await recordFact({
      a: args.a,
      b: args.b,
      edgeType: args.edgeType,
      edgeProps: args.edgeProps,
      source: "agent_inference",
      confidence: args.confidence ?? 0.5,
    });
    const summary = `${result.a.type} "${result.a.name}" -[${result.edge.type}]-> ${result.b.type} "${result.b.name}"`;
    const conf = (args.confidence ?? 0.5).toFixed(2);
    return {
      content: [{ type: "text", text: `Recorded (inferred, conf=${conf}): ${summary}` }],
    };
  },
);

const updateNodeTool = tool(
  "update_node",
  "Update a node's name and/or properties. `props` replaces existing props (not a merge).",
  {
    id: z.string(),
    name: z.string().optional(),
    props: z.record(z.string(), z.unknown()).optional(),
  },
  async (args) => {
    const before = kg.getNode(args.id);
    const node = kg.updateNode(args);
    const nameChanged = before !== null && before.name !== node.name;
    if (nameChanged) {
      try {
        await embedNode(node);
      } catch (err) {
        console.warn(`Re-embedding failed for ${node.id} after rename:`, err);
      }
    }
    return {
      content: [
        { type: "text", text: `Updated ${node.type} "${node.name}" (id: ${node.id})` },
      ],
    };
  },
);

const getNodeNoteTool = tool(
  "get_node_note",
  "Fetch the full markdown body of a node's free-form note. Use when the inline preview in the auto-injected <context> block is cut off mid-sentence on the topic the user just asked about, or when the user clearly wants detail past the preview boundary. Returns the full body verbatim, or 'no note' if the node has none.",
  {
    id: z.string().describe("Node ID (starts with 'node_')"),
  },
  async (args) => {
    const node = kg.getNode(args.id);
    if (!node) {
      return { content: [{ type: "text", text: `Node ${args.id} not found.` }] };
    }
    const note = kg.getNote(args.id);
    return {
      content: [{ type: "text", text: note ? note.body : "no note" }],
    };
  },
);

const recentTool = tool(
  "recent",
  "List recently created or updated nodes. Useful for introspection — 'what have I been remembering?'",
  {
    limit: z.number().int().min(1).max(50).optional().describe("Default 10"),
  },
  async (args) => {
    const nodes = kg.recentNodes(args.limit ?? 10);
    return { content: [{ type: "text", text: JSON.stringify(nodes, null, 2) }] };
  },
);

const statsTool = tool(
  "stats",
  "Summary of the knowledge graph (total nodes, edges, and breakdown by type).",
  {},
  async () => {
    const stats = kg.kgStats();
    return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
  },
);

// Smoke tool for the approval-modal infrastructure (m5p2). Exercises all three
// decision paths end-to-end without needing a downstream consumer wired up.
// Real approval-gated tools (propose_note_edit, propose_node_merge) ship in
// later M5 stories; this tool can be retired once those land.
const approvalTestTool = tool(
  "approval_test",
  "Test scaffold for the approval modal. Sends an approval_request SSE event with the given payload and returns the user's decision verbatim. Use this to exercise the Approve/Deny/Tweak paths during development. Not for production use.",
  {
    payload: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Arbitrary JSON shown in the modal. Defaults to a sample object."),
  },
  async (args) => {
    const payload = args.payload ?? { sample: "hello", note: "approval test" };
    const response = await requestApproval("test", payload);
    return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
  },
);

// First real consumer of the approval modal (m5p2). Builds a `note_edit`
// payload from the current note body + the proposed `new_body`, blocks until
// the user decides, and writes only on approve. The modal renders a
// before/after diff view; tweak feeds the user's adjustment text back into
// the agent loop so it can re-propose with that guidance.
const proposeNoteEditTool = tool(
  "propose_note_edit",
  "Propose an edit to a node's free-form markdown note. The user sees a before/after diff and approves, denies, or tweaks the proposal. Use when the user shares richer or updated context that should land in an existing note (e.g., they just told you the pet's age changed, or consolidated overlapping info during a chat). On approve the new body is saved verbatim. On deny nothing changes. On tweak the user's adjustment text is returned so you can re-propose a tightened edit.",
  {
    nodeId: z
      .string()
      .describe("Node ID whose note to edit (must already exist; starts with 'node_')."),
    newBody: z
      .string()
      .describe(
        "Proposed full markdown body. This replaces the existing body verbatim — write the complete note, not a diff or patch.",
      ),
    reason: z
      .string()
      .describe(
        "One short sentence explaining the change for the user reviewing the diff (e.g., 'updated age to 5 from new chat context').",
      ),
  },
  async (args) => {
    const node = kg.getNode(args.nodeId);
    if (!node) {
      return {
        content: [{ type: "text", text: `Node ${args.nodeId} not found.` }],
      };
    }
    const existing = kg.getNote(args.nodeId);
    const before = existing?.body ?? "";

    // No-op edit: short-circuit before bothering the user with a diff that
    // changes nothing. The agent occasionally re-proposes verbatim; this keeps
    // the modal honest.
    if (before === args.newBody) {
      return {
        content: [
          { type: "text", text: "No change — proposed body matches the current note." },
        ],
      };
    }

    const payload = {
      node: { id: node.id, name: node.name, type: node.type },
      before,
      after: args.newBody,
      reason: args.reason,
    };
    const response = await requestApproval("note_edit", payload);

    switch (response.decision) {
      case "approve": {
        const saved = kg.setNote(args.nodeId, args.newBody);
        return {
          content: [
            {
              type: "text",
              text: `applied — note on ${node.type} "${node.name}" updated at ${saved.updatedAt}.`,
            },
          ],
        };
      }
      case "deny":
        return { content: [{ type: "text", text: "denied by user" }] };
      case "tweak":
        // Hand the user's adjustment text back to the agent loop. Returning
        // structured JSON (not just the prose) so the agent sees this is a
        // tweak response and not free-form chat context.
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ decision: "tweak", tweakText: response.tweakText }),
            },
          ],
        };
      case "timeout":
        return {
          content: [
            {
              type: "text",
              text: "approval timed out — note unchanged. Ask the user if they still want this edit.",
            },
          ],
        };
    }
  },
);

export const kgServer = createSdkMcpServer({
  name: "kg",
  version: "0.2.0",
  tools: [
    searchTool,
    getTool,
    neighborsTool,
    recordUserFactTool,
    recordInferredFactTool,
    updateNodeTool,
    getNodeNoteTool,
    recentTool,
    statsTool,
    approvalTestTool,
    proposeNoteEditTool,
  ],
});

export const KG_TOOL_NAMES = [
  "mcp__kg__search",
  "mcp__kg__get",
  "mcp__kg__neighbors",
  "mcp__kg__record_user_fact",
  "mcp__kg__record_inferred_fact",
  "mcp__kg__update_node",
  "mcp__kg__get_node_note",
  "mcp__kg__recent",
  "mcp__kg__stats",
  "mcp__kg__approval_test",
  "mcp__kg__propose_note_edit",
];
