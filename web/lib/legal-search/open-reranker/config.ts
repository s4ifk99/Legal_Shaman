import { enableOpenReranker as enableOpenRerankerFlag, envBool } from "@/lib/legal-search/config";

export const DEFAULT_OPEN_RERANKER_MODEL = "BAAI/bge-reranker-v2-m3";
export const ALT_OPEN_RERANKER_MODEL = "Qwen/Qwen3-Reranker-0.6B";

export { enableOpenRerankerFlag as enableOpenReranker };

export function openRerankerUseLocal(): boolean {
  return envBool("OPEN_RERANKER_LOCAL", false);
}

export function openRerankerModel(): string {
  return (
    process.env.OPEN_RERANKER_MODEL?.trim() ||
    process.env.HF_RERANKER_MODEL?.trim() ||
    DEFAULT_OPEN_RERANKER_MODEL
  );
}

export function openRerankerConfigured(): boolean {
  if (openRerankerUseLocal()) {
    return Boolean(process.env.OPEN_RERANKER_LOCAL_URL?.trim());
  }
  return Boolean(
    process.env.HUGGINGFACE_API_KEY?.trim() ||
      process.env.HF_TOKEN?.trim() ||
      process.env.OPEN_RERANKER_INFERENCE_URL?.trim(),
  );
}

export function openRerankerInferenceUrl(): string {
  const custom = process.env.OPEN_RERANKER_INFERENCE_URL?.trim();
  if (custom) return custom;
  if (openRerankerUseLocal()) {
    return (
      process.env.OPEN_RERANKER_LOCAL_URL?.trim() || "http://127.0.0.1:8080/rerank"
    );
  }
  return `https://api-inference.huggingface.co/models/${openRerankerModel()}`;
}

export function openRerankerRetrievalLimit(): number {
  const raw = Number(process.env.OPEN_RERANKER_RETRIEVAL_LIMIT);
  return Number.isFinite(raw) && raw >= 20 && raw <= 100 ? Math.floor(raw) : 100;
}

export function openRerankerMaxDelta(): number {
  const raw = Number(process.env.OPEN_RERANKER_MAX_DELTA);
  return Number.isFinite(raw) && raw > 0 && raw <= 0.25 ? raw : 0.12;
}

export function openRerankerBatchSize(): number {
  const raw = Number(process.env.OPEN_RERANKER_BATCH_SIZE);
  return Number.isFinite(raw) && raw >= 8 && raw <= 64 ? Math.floor(raw) : 32;
}

export function openRerankerTimeoutMs(): number {
  const raw = Number(process.env.OPEN_RERANKER_TIMEOUT_MS);
  return Number.isFinite(raw) && raw >= 3000 ? Math.floor(raw) : 15000;
}
