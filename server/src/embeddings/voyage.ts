export const VOYAGE_MODEL = "voyage-3-large";
const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";

export type VoyageInputType = "document" | "query";

interface VoyageResponse {
  data: { embedding: number[]; index: number }[];
  model: string;
  usage: { total_tokens: number };
}

export async function embed(
  inputs: string[],
  inputType: VoyageInputType,
): Promise<number[][]> {
  if (inputs.length === 0) return [];

  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    throw new Error("VOYAGE_API_KEY is not set in the environment.");
  }

  const res = await fetch(VOYAGE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: VOYAGE_MODEL,
      input: inputs,
      input_type: inputType,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Voyage embedding request failed (${res.status}): ${body}`);
  }

  const json = (await res.json()) as VoyageResponse;
  // Voyage may return `data` out of order — sort by index to align with inputs.
  return json.data
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}

export async function embedOne(
  input: string,
  inputType: VoyageInputType,
): Promise<number[]> {
  const [vec] = await embed([input], inputType);
  if (!vec) throw new Error("Voyage returned no embedding for the input.");
  return vec;
}
