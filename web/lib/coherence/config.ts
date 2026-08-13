/**
 * Local-only gate for Coherence intake on /ask-the-shaman.
 * Never on when Vercel (or ENABLE_COHERENCE_ASK unset/false).
 */
export function enableCoherenceAsk(): boolean {
  if (process.env.VERCEL === "1") return false;
  const flag = (process.env.ENABLE_COHERENCE_ASK || "").trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes" || flag === "on";
}

/** Map Signpost env → Coherence agent env (OPENROUTER_*, wiki paths). Call from API routes. */
export function ensureCoherenceServerEnv(): void {
  const apiKey =
    process.env.OPENROUTER_API_KEY?.trim() || process.env.LLM_API_KEY?.trim() || "";
  if (apiKey && !process.env.OPENROUTER_API_KEY) {
    process.env.OPENROUTER_API_KEY = apiKey;
  }

  const model =
    process.env.OPENROUTER_MODEL?.trim() ||
    process.env.LLM_SMALL_MODEL?.trim() ||
    "openai/gpt-4o-mini";
  if (!process.env.OPENROUTER_MODEL) {
    process.env.OPENROUTER_MODEL = model;
  }

  if (!process.env.OPENROUTER_SITE_URL) {
    process.env.OPENROUTER_SITE_URL =
      process.env.OPENROUTER_HTTP_REFERER?.trim() || "http://localhost:3000";
  }
  if (!process.env.OPENROUTER_SITE_NAME) {
    process.env.OPENROUTER_SITE_NAME =
      process.env.OPENROUTER_APP_TITLE?.trim() || "Legal Shaman Coherence Intake";
  }

  if (!process.env.LEGAL_SHAMAN_WIKI_INDEX) {
    process.env.LEGAL_SHAMAN_WIKI_INDEX = `${process.cwd()}/data/wiki-index.json`;
  }
  if (!process.env.LEGAL_SHAMAN_ROOT) {
    process.env.LEGAL_SHAMAN_ROOT = "/home/pravda/Projects/legal_shaman";
  }

  const dataUrl =
    process.env.DATA_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim() || "";
  if (dataUrl && !process.env.DATABASE_URL) {
    process.env.DATABASE_URL = dataUrl;
  }
}

export function coherenceOpenRouterConfig(): {
  apiKey: string;
  model: string;
  siteUrl: string;
  siteName: string;
} {
  ensureCoherenceServerEnv();
  return {
    apiKey: process.env.OPENROUTER_API_KEY?.trim() || "",
    model: process.env.OPENROUTER_MODEL?.trim() || "openai/gpt-4o-mini",
    siteUrl: process.env.OPENROUTER_SITE_URL || "http://localhost:3000",
    siteName: process.env.OPENROUTER_SITE_NAME || "Legal Shaman Coherence Intake",
  };
}

export function coherenceDatabaseUrl(): string {
  return (
    process.env.DATA_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim() || ""
  );
}
