import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { db, link, recordProvenance, type Node } from "./kg/db.js";
import { embedNodes } from "./embeddings/index.js";

// Load .env from the project root (one level above server/) so VOYAGE_API_KEY
// is available when the seed runs as part of `predev`.
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../../.env") });

interface SeedFact {
  a: { nameOrId: string; type: string };
  b: { nameOrId: string; type: string };
  edgeType: string;
}

// Source of truth for what home-ai "knows" at dev startup. Append as the
// project grows.
//
// IMPORTANT: every fact here is asserted as true about the user. Don't seed
// names/relationships you can't verify — the AI will treat them as
// established memory.
const FACTS: SeedFact[] = [
  // ─── Pets ───────────────────────────────────────────────────────
  {
    a: { nameOrId: "user", type: "Person" },
    b: { nameOrId: "Snickers", type: "Pet" },
    edgeType: "OWNS",
  },

  // ─── This project ───────────────────────────────────────────────
  {
    a: { nameOrId: "user", type: "Person" },
    b: { nameOrId: "home-ai", type: "Project" },
    edgeType: "OWNS",
  },

  // ─── home-ai's tech stack ──────────────────────────────────────
  {
    a: { nameOrId: "home-ai", type: "Project" },
    b: { nameOrId: "TypeScript", type: "Topic" },
    edgeType: "DEPENDS_ON",
  },
  {
    a: { nameOrId: "home-ai", type: "Project" },
    b: { nameOrId: "React", type: "Topic" },
    edgeType: "DEPENDS_ON",
  },
  {
    a: { nameOrId: "home-ai", type: "Project" },
    b: { nameOrId: "Vite", type: "Topic" },
    edgeType: "DEPENDS_ON",
  },
  {
    a: { nameOrId: "home-ai", type: "Project" },
    b: { nameOrId: "Tailwind CSS", type: "Topic" },
    edgeType: "DEPENDS_ON",
  },
  {
    a: { nameOrId: "home-ai", type: "Project" },
    b: { nameOrId: "Hono", type: "Topic" },
    edgeType: "DEPENDS_ON",
  },
  {
    a: { nameOrId: "home-ai", type: "Project" },
    b: { nameOrId: "SQLite", type: "Topic" },
    edgeType: "DEPENDS_ON",
  },
  {
    a: { nameOrId: "home-ai", type: "Project" },
    b: { nameOrId: "Node.js", type: "Topic" },
    edgeType: "DEPENDS_ON",
  },

  // ─── External services home-ai integrates with ────────────────
  {
    a: { nameOrId: "home-ai", type: "Project" },
    b: { nameOrId: "Anthropic", type: "Organization" },
    edgeType: "DEPENDS_ON",
  },
  {
    a: { nameOrId: "home-ai", type: "Project" },
    b: { nameOrId: "Voyage AI", type: "Organization" },
    edgeType: "DEPENDS_ON",
  },
  {
    a: { nameOrId: "Anthropic", type: "Organization" },
    b: { nameOrId: "Claude", type: "Topic" },
    edgeType: "RELATES_TO",
  },

  // ─── Concept space the project is in ──────────────────────────
  {
    a: { nameOrId: "home-ai", type: "Project" },
    b: { nameOrId: "Knowledge graphs", type: "Topic" },
    edgeType: "RELATES_TO",
  },
  {
    a: { nameOrId: "home-ai", type: "Project" },
    b: { nameOrId: "Personal AI", type: "Topic" },
    edgeType: "RELATES_TO",
  },
  {
    a: { nameOrId: "home-ai", type: "Project" },
    b: { nameOrId: "Retrieval-augmented generation", type: "Topic" },
    edgeType: "RELATES_TO",
  },
  {
    a: { nameOrId: "home-ai", type: "Project" },
    b: { nameOrId: "Embeddings", type: "Topic" },
    edgeType: "RELATES_TO",
  },
  {
    a: { nameOrId: "Embeddings", type: "Topic" },
    b: { nameOrId: "Voyage AI", type: "Organization" },
    edgeType: "RELATES_TO",
  },

  // ─── User's interests, inferred from the codebase ──────────────
  {
    a: { nameOrId: "user", type: "Person" },
    b: { nameOrId: "TypeScript", type: "Topic" },
    edgeType: "PREFERS",
  },
  {
    a: { nameOrId: "user", type: "Person" },
    b: { nameOrId: "Knowledge graphs", type: "Topic" },
    edgeType: "PREFERS",
  },
  {
    a: { nameOrId: "user", type: "Person" },
    b: { nameOrId: "Personal AI", type: "Topic" },
    edgeType: "PREFERS",
  },

  // ─── Personal facts: paste your own here ──────────────────────
  // Examples (delete and replace with real ones):
  //   { a: {nameOrId: "user", type: "Person"}, b: {nameOrId: "Acme", type: "Organization"}, edgeType: "WORKS_AT" },
  //   { a: {nameOrId: "user", type: "Person"}, b: {nameOrId: "Austin", type: "Place"}, edgeType: "LIVES_WITH" },
  //   { a: {nameOrId: "user", type: "Person"}, b: {nameOrId: "running", type: "Preference"}, edgeType: "PREFERS" },
];

function reset() {
  db.exec(
    `DELETE FROM node_embeddings; DELETE FROM edges; DELETE FROM nodes; DELETE FROM provenance;`,
  );
}

async function run() {
  reset();
  const newNodes: Node[] = [];
  for (const fact of FACTS) {
    const result = link(fact);
    if (result.created.aCreated) {
      newNodes.push(result.a);
      recordProvenance({ factId: result.a.id, factKind: "node", source: "seed" });
    }
    if (result.created.bCreated) {
      newNodes.push(result.b);
      recordProvenance({ factId: result.b.id, factKind: "node", source: "seed" });
    }
    recordProvenance({ factId: result.edge.id, factKind: "edge", source: "seed" });
  }

  if (newNodes.length > 0) await embedNodes(newNodes);

  const nodeCount = (db.prepare("SELECT COUNT(*) c FROM nodes").get() as { c: number }).c;
  const edgeCount = (db.prepare("SELECT COUNT(*) c FROM edges").get() as { c: number }).c;
  const embCount = (
    db.prepare("SELECT COUNT(*) c FROM node_embeddings").get() as { c: number }
  ).c;
  console.log(
    `[seed] wiped + repopulated: ${nodeCount} nodes, ${edgeCount} edges, ${embCount} embeddings`,
  );
}

await run();
