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
// project grows — each entry maps to one `user → thing` edge.
const FACTS: SeedFact[] = [
  {
    a: { nameOrId: "user", type: "Person" },
    b: { nameOrId: "Snickers", type: "Pet" },
    edgeType: "OWNS",
  },
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
