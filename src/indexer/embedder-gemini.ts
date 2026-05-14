const MODEL = "gemini-embedding-001";
const BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const BATCH_SIZE = 100;

export interface EmbedderOpts {
  apiKey: string;
  fetchFn?: typeof fetch;
}

interface BatchResponse {
  embeddings: Array<{ values: number[] }>;
}
interface SingleResponse {
  embedding: { values: number[] };
}

async function postJson<T>(url: string, body: unknown, fetchFn: typeof fetch): Promise<T> {
  const res = await fetchFn(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = "";
    try { detail = await res.text(); } catch {}
    throw new Error(`Gemini embedding API ${res.status}: ${detail.slice(0, 500)}`);
  }
  return (await res.json()) as T;
}

export async function embedBatch(inputs: string[], opts: EmbedderOpts): Promise<number[][]> {
  const fetchFn = opts.fetchFn ?? fetch;
  const out: number[][] = [];
  for (let i = 0; i < inputs.length; i += BATCH_SIZE) {
    const slice = inputs.slice(i, i + BATCH_SIZE);
    const url = `${BASE}/${MODEL}:batchEmbedContents?key=${encodeURIComponent(opts.apiKey)}`;
    const body = {
      requests: slice.map((text) => ({
        model: `models/${MODEL}`,
        content: { parts: [{ text }] },
        taskType: "RETRIEVAL_DOCUMENT",
      })),
    };
    const resp = await postJson<BatchResponse>(url, body, fetchFn);
    if (!Array.isArray(resp.embeddings) || resp.embeddings.length !== slice.length) {
      throw new Error(`Gemini batch returned ${resp.embeddings?.length ?? 0} embeddings; expected ${slice.length}`);
    }
    for (const e of resp.embeddings) out.push(e.values);
  }
  return out;
}

export async function embedQuery(text: string, opts: EmbedderOpts): Promise<number[]> {
  const fetchFn = opts.fetchFn ?? fetch;
  const url = `${BASE}/${MODEL}:embedContent?key=${encodeURIComponent(opts.apiKey)}`;
  const body = {
    model: `models/${MODEL}`,
    content: { parts: [{ text }] },
    taskType: "RETRIEVAL_QUERY",
  };
  const resp = await postJson<SingleResponse>(url, body, fetchFn);
  return resp.embedding.values;
}
