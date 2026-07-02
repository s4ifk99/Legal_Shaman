const OPENROUTER_DEFAULT_BASE = "https://openrouter.ai/api/v1";

export function resolveLlmApiKey(): string | undefined {
  return (
    process.env.LLM_API_KEY?.trim() ||
    process.env.OPENROUTER_API_KEY?.trim() ||
    undefined
  );
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

export { OPENROUTER_DEFAULT_BASE };
