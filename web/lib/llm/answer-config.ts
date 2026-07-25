import { isHomeOllamaBaseUrl, isOpenRouterBaseUrl, resolveLlmBaseUrl } from "@/lib/llm/openrouter";

/**
 * Vercel synthesis gate. When unset on Vercel, answers fall back to excerpts.
 * Set ENABLE_LLM_ANSWER=true in production so OpenRouter can synthesise guidance.
 */
export function enableLlmAnswer(): boolean {
  const raw = process.env.ENABLE_LLM_ANSWER?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "no") return false;
  if (raw === "1" || raw === "true" || raw === "yes") return true;
  // Local/dev: allow synthesis when configured; Vercel requires explicit opt-in.
  return process.env.VERCEL !== "1";
}

/** Prefer a fast OpenRouter model on Vercel to stay under serverless timeouts. */
export function resolveSynthesisModel(): string {
  const small = process.env.LLM_SMALL_MODEL?.trim();
  if (process.env.VERCEL === "1") {
    return small || "openai/gpt-4o-mini";
  }
  return (
    small ||
    process.env.LLM_MODEL?.trim() ||
    process.env.LLM_CHAT_MODEL?.trim() ||
    (isOpenRouterBaseUrl(resolveLlmBaseUrl()) ? "openai/gpt-4o-mini" : "gpt-4o-mini")
  );
}

export function llmAnswerEnvIssues(): string[] {
  const issues: string[] = [];
  const key =
    process.env.LLM_API_KEY?.trim() || process.env.OPENROUTER_API_KEY?.trim();
  if (!key) issues.push("LLM_API_KEY (or OPENROUTER_API_KEY) missing");

  const base = resolveLlmBaseUrl();
  if (isHomeOllamaBaseUrl(base)) {
    issues.push("LLM_BASE_URL points at home Ollama / trycloudflare (not usable from Vercel)");
  } else if (!isOpenRouterBaseUrl(base) && process.env.VERCEL === "1") {
    issues.push(`LLM_BASE_URL should be OpenRouter on Vercel (got ${base})`);
  }

  if (process.env.VERCEL === "1" && !enableLlmAnswer()) {
    issues.push("ENABLE_LLM_ANSWER is not true — synthesis disabled on Vercel");
  }

  return issues;
}
