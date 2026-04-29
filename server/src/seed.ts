import { db, link } from "./kg/db.js";

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
  db.exec(`DELETE FROM edges; DELETE FROM nodes; DELETE FROM provenance;`);
}

function run() {
  reset();
  for (const fact of FACTS) link(fact);
  const nodeCount = (db.prepare("SELECT COUNT(*) c FROM nodes").get() as { c: number }).c;
  const edgeCount = (db.prepare("SELECT COUNT(*) c FROM edges").get() as { c: number }).c;
  console.log(`[seed] wiped + repopulated: ${nodeCount} nodes, ${edgeCount} edges`);
}

run();
