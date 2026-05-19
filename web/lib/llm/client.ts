import "server-only";

import OpenAI from "openai";

/**
 * OpenAI-compatible LLM client (chat + embeddings).
 *
 * Aliases (optional):
 *   LLM_MODEL          — same as LLM_CHAT_MODEL
 *   EMBEDDING_BASE_URL, EMBEDDING_API_KEY, EMBEDDING_MODEL — dedicated embed endpoint;
 *   when unset, embeddings use LLM_BASE_URL + LLM_API_KEY + LLM_EMBED_MODEL.
 */

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_CHAT_MODEL = "gpt-4o-mini";
const DEFAULT_EMBED_MODEL = "text-embedding-3-small";
const DEFAULT_EMBED_DIM = 1536;

let _chatClient: OpenAI | null = null;
let _embedClient: OpenAI | null = null;

export function llmConfigured(): boolean {
  return Boolean(process.env.LLM_API_KEY?.trim());
}

export function embedConfigured(): boolean {
  return Boolean(
    process.env.EMBEDDING_API_KEY?.trim() || process.env.LLM_API_KEY?.trim(),
  );
}

export function llmEmbedDim(): number {
  const raw = process.env.LLM_EMBED_DIM;
  const n = raw ? Number(raw) : DEFAULT_EMBED_DIM;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_EMBED_DIM;
}

function getChatClient(): OpenAI {
  if (_chatClient) return _chatClient;
  const apiKey = process.env.LLM_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "LLM_API_KEY is not set. Configure it in .env.local (any non-empty string for Ollama).",
    );
  }
  _chatClient = new OpenAI({
    apiKey,
    baseURL: process.env.LLM_BASE_URL?.trim() || DEFAULT_BASE_URL,
  });
  return _chatClient;
}

function getEmbedClient(): OpenAI {
  if (_embedClient) return _embedClient;
  const embedKey = process.env.EMBEDDING_API_KEY?.trim();
  const embedBase =
    process.env.EMBEDDING_BASE_URL?.trim() ||
    process.env.LLM_BASE_URL?.trim() ||
    DEFAULT_BASE_URL;
  if (embedKey) {
    _embedClient = new OpenAI({ apiKey: embedKey, baseURL: embedBase });
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
};

export async function chat(
  messages: ChatMessage[],
  options: ChatOptions = {},
): Promise<string> {
  const client = getChatClient();
  const model =
    options.model ||
    process.env.LLM_MODEL?.trim() ||
    process.env.LLM_CHAT_MODEL?.trim() ||
    DEFAULT_CHAT_MODEL;
  const response = await client.chat.completions.create({
    model,
    messages,
    temperature: options.temperature ?? 0.2,
    max_tokens: options.maxTokens ?? 400,
    response_format: options.jsonMode ? { type: "json_object" } : undefined,
  });
  return response.choices[0]?.message?.content ?? "";
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
