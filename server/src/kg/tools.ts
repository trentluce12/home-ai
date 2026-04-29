import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import * as kg from "./db.js";

const searchTool = tool(
  "search",
  "Full-text search over the knowledge graph. Returns matching nodes (Person, Place, Device, etc.). Use before answering personal-context questions.",
  {
    query: z.string().describe("Search query — matched against node names and properties"),
    types: z.array(z.string()).optional().describe("Filter by entity types"),
    limit: z.number().int().min(1).max(50).optional().describe("Max results (default 10)"),
  },
  async (args) => {
    const results = kg.search({ query: args.query, types: args.types, limit: args.limit });
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
    withNeighbors: z.boolean().optional().describe("Include 1-hop neighbors (default false)"),
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

const addNodeTool = tool(
  "add_node",
  "Create a new node. Prefer using `link` instead, which find-or-creates both nodes plus an edge in one shot. Use `add_node` only when you need a node without an immediate connection.",
  {
    type: z
      .string()
      .describe(
        "Entity type — typically one of: Person, Place, Device, Project, Task, Event, Preference, Document, Topic, Organization, Pet",
      ),
    name: z.string().describe("Human-readable name"),
    props: z.record(z.string(), z.unknown()).optional(),
  },
  async (args) => {
    const node = kg.addNode({ type: args.type, name: args.name, props: args.props });
    return {
      content: [{ type: "text", text: `Created ${node.type} "${node.name}" (id: ${node.id})` }],
    };
  },
);

const addEdgeTool = tool(
  "add_edge",
  "Create a relationship between two existing nodes (use IDs from add_node, search, or link).",
  {
    fromId: z.string(),
    toId: z.string(),
    type: z
      .string()
      .describe(
        "Edge type — typically one of: KNOWS, LIVES_WITH, WORKS_AT, OWNS, LOCATED_IN, PART_OF, RELATES_TO, SCHEDULED_FOR, ASSIGNED_TO, PREFERS, DEPENDS_ON, MENTIONED_IN",
      ),
    props: z.record(z.string(), z.unknown()).optional(),
    confidence: z.number().min(0).max(1).optional().describe("0-1, default 1.0"),
  },
  async (args) => {
    const edge = kg.addEdge(args);
    return {
      content: [
        {
          type: "text",
          text: `Created edge ${edge.type}: ${edge.fromId} → ${edge.toId} (id: ${edge.id})`,
        },
      ],
    };
  },
);

const linkTool = tool(
  "link",
  "Find-or-create two nodes by name and connect them. THIS IS THE WORKHORSE for self-learning — prefer it over manual add_node + add_edge whenever you're recording a new fact about the user. If a node doesn't exist yet, you must provide a `type` so it can be auto-created.",
  {
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
    confidence: z.number().min(0).max(1).optional(),
  },
  async (args) => {
    const result = kg.link(args);
    const summary = `${result.a.type} "${result.a.name}" -[${result.edge.type}]-> ${result.b.type} "${result.b.name}"`;
    const noteA = result.created.aCreated ? ` (new: ${result.a.id})` : "";
    const noteB = result.created.bCreated ? ` (new: ${result.b.id})` : "";
    return { content: [{ type: "text", text: `Linked: ${summary}${noteA}${noteB}` }] };
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
    const node = kg.updateNode(args);
    return {
      content: [{ type: "text", text: `Updated ${node.type} "${node.name}" (id: ${node.id})` }],
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

export const kgServer = createSdkMcpServer({
  name: "kg",
  version: "0.1.0",
  tools: [
    searchTool,
    getTool,
    neighborsTool,
    addNodeTool,
    addEdgeTool,
    linkTool,
    updateNodeTool,
    recentTool,
    statsTool,
  ],
});

export const KG_TOOL_NAMES = [
  "mcp__kg__search",
  "mcp__kg__get",
  "mcp__kg__neighbors",
  "mcp__kg__add_node",
  "mcp__kg__add_edge",
  "mcp__kg__link",
  "mcp__kg__update_node",
  "mcp__kg__recent",
  "mcp__kg__stats",
];
