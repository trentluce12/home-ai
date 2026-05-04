import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { db, link, recordProvenance, setNote, type Node } from "./kg/db.js";
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

  // ─── M5 smoke-test fixtures: case-duplicate nodes for propose_node_merge ──
  // These create lowercase variants of canonical Topics so the agent has
  // obvious merge candidates to surface when asked about duplicates. Edges
  // are parallel to the canonical-cased ones, so a merge will exercise the
  // (other_end, edge_type) dedup path. Delete once smoke is done.
  {
    a: { nameOrId: "home-ai", type: "Project" },
    b: { nameOrId: "react", type: "Topic" },
    edgeType: "DEPENDS_ON",
  },
  {
    a: { nameOrId: "user", type: "Person" },
    b: { nameOrId: "typescript", type: "Topic" },
    edgeType: "PREFERS",
  },

  // ─── Personal facts: paste your own here ──────────────────────
  // Examples (delete and replace with real ones):
  //   { a: {nameOrId: "user", type: "Person"}, b: {nameOrId: "Acme", type: "Organization"}, edgeType: "WORKS_AT" },
  //   { a: {nameOrId: "user", type: "Person"}, b: {nameOrId: "Austin", type: "Place"}, edgeType: "LIVES_WITH" },
  //   { a: {nameOrId: "user", type: "Person"}, b: {nameOrId: "running", type: "Preference"}, edgeType: "PREFERS" },
];

interface SeedNote {
  /** Looks up the parent node by `(nodeName, type)`. */
  nodeName: string;
  type: string;
  /**
   * Display label for the note itself (M6 phase 2). Decoupled from the
   * parent node's name — a note attached to `Person:Alice` might be called
   * "Alice's birthday list" without renaming Alice. Defaulting to the node
   * name keeps the seed's starting state sensible while exercising the
   * decoupled-name code path.
   */
  noteName: string;
  body: string;
}

// Notes seeded on dev startup. Same source-of-truth posture as FACTS:
// every note is asserted as the user's truth, so don't write things the AI
// shouldn't treat as established memory. Several bodies exceed 200 chars so
// the retrieval-preview truncation path is exercised.
const NOTES: SeedNote[] = [
  {
    nodeName: "Snickers",
    type: "Pet",
    noteName: "Snickers",
    body: `Snickers is a 4-year-old golden retriever. Loves squeaky toys (especially the orange duck), gets the zoomies after baths, and only eats kibble if it's mixed with a spoonful of plain yogurt. Mildly afraid of the vacuum but pretends to be braver than he is. Allergic to chicken — switched him to a salmon-based food in early 2026.`,
  },
  {
    nodeName: "home-ai",
    type: "Project",
    noteName: "home-ai",
    body: `# home-ai

A personal "home AI" — local-first chat UI on top of the Anthropic API, layered over a SQLite knowledge graph the agent reads from and writes back into.

## Why
Off-the-shelf chatbots forget everything between sessions. home-ai treats memory as a first-class concern: every meaningful fact lands as a node + edge in the KG, and every chat turn injects a relevant subgraph as passive context.

## Status (2026-05-03)
- M0–M4.5 shipped (chat, KG self-learning, passive subgraph injection, hybrid retrieval, sessions/dashboard/markdown, graph viz, bulk import, auth + Docker)
- M5 in progress: node-attached notes layer (this note is itself a phase 1 smoke fixture)

## Tech
TypeScript + React + Vite + Tailwind on the frontend; Hono + Anthropic Agent SDK on the server; better-sqlite3 + Voyage embeddings + FTS5 for the KG.`,
  },
  {
    nodeName: "TypeScript",
    type: "Topic",
    noteName: "TypeScript",
    body: `User has been writing TypeScript professionally since ~2019. Strong preference for strict mode, no \`any\`, and SDK types over hand-rolled equivalents. Avoids \`!\` non-null assertions on principle.`,
  },
  {
    nodeName: "Knowledge graphs",
    type: "Topic",
    noteName: "Knowledge graphs",
    body: `Why home-ai is built around a KG rather than vector search alone:

- **Edges carry semantics that embeddings flatten.** "user OWNS Snickers" vs. "user FEARS Snickers" both embed nearby; the edge type disambiguates.
- **Provenance is queryable.** Every fact has a source (user_statement / agent_inference / seed / bulk_import / merged_from_X) so the agent can flag low-confidence inferences.
- **The graph is a UI surface, not just retrieval plumbing.** The Sigma-based modal lets the user see + curate what the AI thinks it knows.

Hybrid retrieval (FTS + cosine via RRF) sits on top — embeddings handle paraphrase, FTS handles exact tokens, edges handle structure.`,
  },
];

function reset() {
  db.exec(
    `DELETE FROM node_notes; DELETE FROM node_embeddings; DELETE FROM edges; DELETE FROM nodes; DELETE FROM provenance;`,
  );
}

async function run() {
  reset();
  const newNodes: Node[] = [];
  const nodeKeyToId = new Map<string, string>();
  const keyOf = (name: string, type: string) => `${type}:${name}`;
  for (const fact of FACTS) {
    const result = link(fact);
    nodeKeyToId.set(keyOf(result.a.name, result.a.type), result.a.id);
    nodeKeyToId.set(keyOf(result.b.name, result.b.type), result.b.id);
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

  let noteCount = 0;
  for (const note of NOTES) {
    const id = nodeKeyToId.get(keyOf(note.nodeName, note.type));
    if (!id) {
      console.warn(
        `[seed] skipping note for ${note.type}:${note.nodeName} — no matching node`,
      );
      continue;
    }
    setNote(id, note.body, note.noteName);
    noteCount++;
  }

  const nodeCount = (db.prepare("SELECT COUNT(*) c FROM nodes").get() as { c: number }).c;
  const edgeCount = (db.prepare("SELECT COUNT(*) c FROM edges").get() as { c: number }).c;
  const embCount = (
    db.prepare("SELECT COUNT(*) c FROM node_embeddings").get() as { c: number }
  ).c;
  console.log(
    `[seed] wiped + repopulated: ${nodeCount} nodes, ${edgeCount} edges, ${embCount} embeddings, ${noteCount} notes`,
  );
}

await run();
