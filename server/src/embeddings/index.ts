import { upsertEmbedding, type Node } from "../kg/db.js";
import { embed, embedOne, VOYAGE_MODEL } from "./voyage.js";

function nodeText(node: Pick<Node, "type" | "name">): string {
  return `${node.type}: ${node.name}`;
}

export async function embedNode(node: Node): Promise<void> {
  const vec = await embedOne(nodeText(node), "document");
  upsertEmbedding({ nodeId: node.id, model: VOYAGE_MODEL, vector: vec });
}

export async function embedNodes(nodes: Node[]): Promise<void> {
  if (nodes.length === 0) return;
  const vectors = await embed(nodes.map(nodeText), "document");
  for (let i = 0; i < nodes.length; i++) {
    const vec = vectors[i];
    if (!vec) continue;
    upsertEmbedding({ nodeId: nodes[i]!.id, model: VOYAGE_MODEL, vector: vec });
  }
}

export async function embedQuery(text: string): Promise<number[]> {
  return embedOne(text, "query");
}

export { VOYAGE_MODEL };
