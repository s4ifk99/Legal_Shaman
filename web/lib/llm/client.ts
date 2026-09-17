import "server-only";

import OpenAI from "openai";

import {
  estimateCostUsd,
  estimateTokensFromChars,
  gateLlmCall,
  recordLlmCall,
  type LlmCallReason,
} from "@/lib/coherence/llm-budget";
import {
  isInsufficientCreditsError,
  isRateLimitedOrUnavailableError,
  openRouterDefaultHeaders,
  resolveChatModel,
  resolveFreeFallbackModel,
  resolveLlmApiKey,
  resolveLlmBaseUrl,
  isHomeOllamaBaseUrl,
} from "./openrouter";

/**
 * OpenAI-compatible LLM client (chat + embeddings).
 * OpenRouter: set in `web/.env.local`:
 *   LLM_API_KEY=sk-or-...
 *   LLM_BASE_URL=https://openrouter.ai/api/v1
 *   LLM_MODEL=openai/gpt-4o-mini  (or e.g. qwen/qwen3-32b)
 *
 * Aliases: OPENROUTER_API_KEY, OPENROUTER_BASE_URL, LLM_CHAT_MODEL
 */

const DEFAULT_EMBED_MODEL = "text-embedding-3-small";
const DEFAULT_EMBED_DIM = 1536;

let _chatClient: OpenAI | null = null;
let _embedClient: OpenAI | null = null;

export function llmConfigured(): boolean {
  return Boolean(resolveLlmApiKey());
}

export function embedConfigured(): boolean {
  return Boolean(process.env.EMBEDDING_API_KEY?.trim() || resolveLlmApiKey());
}

export function llmEmbedDim(): number {
  const raw = process.env.LLM_EMBED_DIM;
  const n = raw ? Number(raw) : DEFAULT_EMBED_DIM;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_EMBED_DIM;
}

function getChatClient(): OpenAI {
  if (_chatClient) return _chatClient;
  const apiKey = resolveLlmApiKey();
  if (!apiKey) {
    throw new Error(
      "LLM_API_KEY is not set. Add your OpenRouter key to web/.env.local (LLM_API_KEY + LLM_BASE_URL=https://openrouter.ai/api/v1).",
    );
  }
  const baseURL = resolveLlmBaseUrl();
  if (isHomeOllamaBaseUrl(baseURL) && process.env.VERCEL === "1") {
    throw new Error(
      "Home Ollama is not usable from Vercel (tunnel latency). Set LLM_BASE_URL=https://openrouter.ai/api/v1.",
    );
  }
  const defaultHeaders = openRouterDefaultHeaders();
  // Overview chat needs ≥45s; do not rely only on /answer mutating LLM_TIMEOUT_MS.
  const defaultTimeout = 45_000;
  const timeoutMs = Number(process.env.LLM_TIMEOUT_MS ?? defaultTimeout);
  _chatClient = new OpenAI({
    apiKey,
    baseURL,
    timeout: Number.isFinite(timeoutMs) ? timeoutMs : defaultTimeout,
    maxRetries: 0,
    ...(defaultHeaders ? { defaultHeaders } : {}),
  });
  return _chatClient;
}

function getEmbedClient(): OpenAI {
  if (_embedClient) return _embedClient;
  const embedKey = process.env.EMBEDDING_API_KEY?.trim();
  const embedBase =
    process.env.EMBEDDING_BASE_URL?.trim() || resolveLlmBaseUrl();
  if (isHomeOllamaBaseUrl(embedBase) && process.env.VERCEL === "1") {
    throw new Error(
      "Home Ollama embeddings are not usable from Vercel. Set EMBEDDING_BASE_URL to OpenRouter/OpenAI.",
    );
  }
  const timeoutMs = Number(process.env.LLM_EMBED_TIMEOUT_MS ?? 15_000);
  if (embedKey) {
    _embedClient = new OpenAI({
      apiKey: embedKey,
      baseURL: embedBase,
      timeout: Number.isFinite(timeoutMs) ? timeoutMs : 15_000,
      maxRetries: 0,
    });
    return _embedClient;
  }
  _embedClient = getChatClient();
  return _embedClient;
}

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatOptions = {
  jsonMode?: boolean;
  temperature?: number;
  maxTokens?: number;
  model?: string;
  /** Per-request timeout; Overview needs ≥45s even if a caller left the env low. */
  timeoutMs?: number;
  /** Coherence cost attribution — set on master-path calls. */
  purpose?: LlmCallReason;
  caller?: string;
  attempt?: number;
  retryReason?: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function chatWithModel(
  client: OpenAI,
  messages: ChatMessage[],
  options: ChatOptions,
  model: string,
): Promise<string> {
  const response = await client.chat.completions.create(
    {
      model,
      messages,
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxTokens ?? 400,
      response_format: options.jsonMode ? { type: "json_object" } : undefined,
    },
    options.timeoutMs && Number.isFinite(options.timeoutMs)
      ? { timeout: options.timeoutMs }
      : undefined,
  );
  return response.choices[0]?.message?.content ?? "";
}

export async function chat(
  messages: ChatMessage[],
  options: ChatOptions = {},
): Promise<string> {
  const purpose = options.purpose || "legacy_other";
  const caller = options.caller || "llm.client.chat";
  const gate = gateLlmCall(purpose, caller);
  if (gate.warn) console.warn(`[coherence-cost] ${gate.warn}`);
  if (!gate.allowed) {
    throw new Error(gate.warn || "LLM call rejected by hard budget");
  }

  const client = getChatClient();
  const model = resolveChatModel(options.model);
  const inputChars = messages.reduce((s, m) => s + (m.content?.length || 0), 0);
  const t0 = Date.now();
  let attempt = options.attempt || 1;
  let usedModel = model;
  let content = "";
  let retryReason = options.retryReason;

  try {
    content = await chatWithModel(client, messages, options, model);
  } catch (err) {
    const fallback = resolveFreeFallbackModel();
    let lastErr: unknown = err;

    if (isRateLimitedOrUnavailableError(err)) {
      for (let i = 0; i < 2; i++) {
        const delayMs = 500 * (i + 1);
        console.warn(`[llm] ${model} 429/503; backoff ${delayMs}ms (retry ${i + 1}/2)`);
        await sleep(delayMs);
        attempt += 1;
        retryReason = "rate_limit_backoff";
        try {
          content = await chatWithModel(client, messages, options, model);
          lastErr = null;
          break;
        } catch (retryErr) {
          lastErr = retryErr;
          if (!isRateLimitedOrUnavailableError(retryErr)) break;
        }
      }
      if (lastErr && fallback && fallback !== model) {
        console.warn(`[llm] ${model} still 429/503; retrying with ${fallback}`);
        attempt += 1;
        retryReason = "rate_limit_free_fallback";
        usedModel = fallback;
        try {
          content = await chatWithModel(client, messages, options, fallback);
          lastErr = null;
        } catch (err2) {
          lastErr = err2;
        }
      }
    } else if (fallback && fallback !== model && isInsufficientCreditsError(err)) {
      console.warn(`[llm] ${model} insufficient credits; retrying with ${fallback}`);
      attempt = 2;
      retryReason = "insufficient_credits_fallback";
      usedModel = fallback;
      try {
        content = await chatWithModel(client, messages, options, fallback);
        lastErr = null;
      } catch (err2) {
        lastErr = err2;
      }
    }

    if (lastErr) {
      recordLlmCall({
        purpose,
        caller,
        model: usedModel,
        attempt,
        ok: false,
        latencyMs: Date.now() - t0,
        inputChars,
        outputChars: 0,
        estimatedInputTokens: estimateTokensFromChars(inputChars),
        estimatedOutputTokens: 0,
        estimatedCostUsd: 0,
        retryReason,
        error: lastErr instanceof Error ? lastErr.message : String(lastErr),
      });
      throw lastErr;
    }
  }

  const outputChars = content.length;
  const estimatedInputTokens = estimateTokensFromChars(inputChars);
  const estimatedOutputTokens = estimateTokensFromChars(outputChars);
  recordLlmCall({
    purpose,
    caller,
    model: usedModel,
    attempt,
    ok: Boolean(content),
    latencyMs: Date.now() - t0,
    inputChars,
    outputChars,
    estimatedInputTokens,
    estimatedOutputTokens,
    estimatedCostUsd: estimateCostUsd(estimatedInputTokens, estimatedOutputTokens),
    retryReason,
  });

  return content;
}

export async function embed(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  const client = getEmbedClient();
  const model =
    process.env.EMBEDDING_MODEL?.trim() ||
    process.env.LLM_EMBED_MODEL?.trim() ||
    DEFAULT_EMBED_MODEL;
  const dim = llmEmbedDim();

  const cleaned = texts.map((t) => (t ?? "").toString().trim().slice(0, 8000) || " ");
  const response = await client.embeddings.create({
    model,
    input: cleaned,
  });

  return response.data.map((row) => {
    const arr = Array.isArray(row.embedding) ? row.embedding : Array.from(row.embedding as number[]);
    if (arr.length === dim) return new Float32Array(arr);
    if (arr.length > dim) return new Float32Array(arr.slice(0, dim));
    const padded = new Float32Array(dim);
    padded.set(arr);
    return padded;
  });
}

export async function embedOne(text: string): Promise<Float32Array> {
  const [v] = await embed([text]);
  if (!v) throw new Error("Embedding returned no vectors");
  return v;
}

export function toPgVectorLiteral(v: Float32Array | number[]): string {
  const arr = v instanceof Float32Array ? Array.from(v) : v;
  return `[${arr.map((x) => (Number.isFinite(x) ? x.toFixed(6) : "0")).join(",")}]`;
}
