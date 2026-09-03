const OPENROUTER_DEFAULT_BASE = "https://openrouter.ai/api/v1";

export function resolveLlmApiKey(): string | undefined {
  const explicitBase =
    process.env.LLM_BASE_URL?.trim() || process.env.OPENROUTER_BASE_URL?.trim();
  const openRouterKey = process.env.OPENROUTER_API_KEY?.trim();
  const llmKey = process.env.LLM_API_KEY?.trim();

  // When the base URL explicitly targets OpenRouter, do not let an older
  // provider-specific LLM_API_KEY shadow the current OpenRouter credential.
  if (explicitBase && isOpenRouterBaseUrl(explicitBase)) {
    return openRouterKey || llmKey || undefined;
  }

  return llmKey || openRouterKey || undefined;
}

export function resolveLlmBaseUrl(): string {
  const explicit =
    process.env.LLM_BASE_URL?.trim() || process.env.OPENROUTER_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  const key = resolveLlmApiKey();
  if (key?.startsWith("sk-or-")) return OPENROUTER_DEFAULT_BASE;

  return "https://api.openai.com/v1";
}

export function isOpenRouterBaseUrl(baseUrl: string): boolean {
  return /openrouter\.ai/i.test(baseUrl);
}

/** Self-hosted Ollama (local or trycloudflare tunnel). Too slow for Vercel Hobby (~10s). */
export function isHomeOllamaBaseUrl(baseUrl?: string): boolean {
  const url = (baseUrl ?? resolveLlmBaseUrl()).toLowerCase();
  return /trycloudflare\.com|127\.0\.0\.1:1143|localhost:1143/.test(url);
}

export function openRouterDefaultHeaders(): Record<string, string> | undefined {
  const baseUrl = resolveLlmBaseUrl();
  if (!isOpenRouterBaseUrl(baseUrl)) return undefined;

  return {
    "HTTP-Referer":
      process.env.OPENROUTER_HTTP_REFERER?.trim() ||
      process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
      "https://legalshaman.com",
    "X-Title": process.env.OPENROUTER_APP_TITLE?.trim() || "Legal Shaman",
  };
}

export function resolveChatModel(explicit?: string): string {
  return (
    explicit?.trim() ||
    process.env.LLM_MODEL?.trim() ||
    process.env.LLM_CHAT_MODEL?.trim() ||
    (isOpenRouterBaseUrl(resolveLlmBaseUrl()) ? "openai/gpt-4o-mini" : "gpt-4o-mini")
  );
}

/** Free OpenRouter model used when paid models return 402 (no credits). */
export function resolveFreeFallbackModel(): string | undefined {
  const explicit = process.env.LLM_FREE_MODEL?.trim();
  if (explicit) return explicit;
  if (isOpenRouterBaseUrl(resolveLlmBaseUrl())) {
    return "google/gemma-4-26b-a4b-it:free";
  }
  return undefined;
}

export function isInsufficientCreditsError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  if (/402|insufficient credits/i.test(message)) return true;
  const status = (err as { status?: number })?.status;
  return status === 402;
}

export function isRateLimitedOrUnavailableError(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  if (status === 429 || status === 503) return true;
  const message = err instanceof Error ? err.message : String(err);
  return /429|503|rate.?limit|overloaded|service unavailable/i.test(message);
}

export function isLlmTimeoutError(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  if (status === 408) return true;
  const message = err instanceof Error ? err.message : String(err);
  return /timeout|timed out|ETIMEDOUT|AbortError|deadline exceeded/i.test(message);
}

export { OPENROUTER_DEFAULT_BASE };
