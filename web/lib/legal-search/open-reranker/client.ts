import "server-only";

import {
  openRerankerBatchSize,
  openRerankerInferenceUrl,
  openRerankerModel,
  openRerankerTimeoutMs,
  openRerankerUseLocal,
} from "@/lib/legal-search/open-reranker/config";

export type OpenRerankerScoreResult = {
  scores: number[];
  model: string;
  degraded: boolean;
  error?: string;
};

function hfApiKey(): string | undefined {
  return (
    process.env.HUGGINGFACE_API_KEY?.trim() ||
    process.env.HF_TOKEN?.trim() ||
    undefined
  );
}

function parseScorePayload(data: unknown, expected: number): number[] | null {
  if (data == null) return null;

  if (Array.isArray(data)) {
    const flat: number[] = [];
    for (const row of data) {
      if (typeof row === "number" && Number.isFinite(row)) {
        flat.push(row);
      } else if (Array.isArray(row)) {
        const n = row.find((x) => typeof x === "number" && Number.isFinite(x));
        if (typeof n === "number") flat.push(n);
      } else if (row && typeof row === "object") {
        const score = (row as { score?: number; label?: string }).score;
        if (typeof score === "number" && Number.isFinite(score)) flat.push(score);
      }
    }
    if (flat.length === expected) return flat;
  }

  if (typeof data === "object" && data !== null) {
    const scores = (data as { scores?: number[] }).scores;
    if (Array.isArray(scores) && scores.length === expected) return scores;
  }

  return null;
}

async function postRerankBatch(
  pairs: [string, string][],
  model: string,
): Promise<number[] | null> {
  const url = openRerankerInferenceUrl();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const key = hfApiKey();
  if (key && !openRerankerUseLocal()) {
    headers.Authorization = `Bearer ${key}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), openRerankerTimeoutMs());

  try {
    const body = openRerankerUseLocal()
      ? { query: pairs[0]?.[0] ?? "", documents: pairs.map((p) => p[1]) }
      : { inputs: pairs };

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn(
        JSON.stringify({
          event: "open_reranker_http_error",
          model,
          status: res.status,
          detail: text.slice(0, 200),
        }),
      );
      return null;
    }

    const data: unknown = await res.json();
    return parseScorePayload(data, pairs.length);
  } catch (e) {
    console.warn(
      JSON.stringify({
        event: "open_reranker_request_failed",
        model,
        error: String(e),
      }),
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Score query–document pairs via hosted HF inference (or local endpoint when enabled).
 */
export async function scoreOpenRerankerPairs(
  pairs: [string, string][],
): Promise<OpenRerankerScoreResult> {
  const model = openRerankerModel();
  if (!pairs.length) {
    return { scores: [], model, degraded: false };
  }

  const scores: number[] = [];
  const batch = openRerankerBatchSize();
  let degraded = false;

  for (let i = 0; i < pairs.length; i += batch) {
    const chunk = pairs.slice(i, i + batch);
    const chunkScores = await postRerankBatch(chunk, model);
    if (!chunkScores) {
      degraded = true;
      scores.push(...chunk.map(() => 0));
      continue;
    }
    scores.push(...chunkScores);
  }

  return {
    scores,
    model,
    degraded,
    error: degraded ? "partial_or_full_reranker_degraded" : undefined,
  };
}
