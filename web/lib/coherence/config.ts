function enabledFlag(value?: string): boolean {
  const flag = (value || "").trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes" || flag === "on";
}

function vercelCoherenceV2Enabled(): boolean {
  const mode = (process.env.COHERENCE_MODE || "legacy").trim().toLowerCase();
  return (
    process.env.VERCEL === "1" &&
    enabledFlag(process.env.ENABLE_COHERENCE_V2) &&
    (mode === "v2" || mode === "shadow")
  );
}

function vercelArambEnabled(): boolean {
  return process.env.VERCEL === "1" && enabledFlag(process.env.ENABLE_ARAMB_PILOT);
}

/**
 * Gate Coherence intake on /ask-the-shaman and its server APIs.
 * Local development uses ENABLE_COHERENCE_ASK; staged V2 or Aramb production
 * uses the corresponding server-side feature flag.
 */
export function enableCoherenceAsk(): boolean {
  if (process.env.VERCEL === "1") return vercelCoherenceV2Enabled() || vercelArambEnabled();
  return enabledFlag(process.env.ENABLE_COHERENCE_ASK);
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

function isPlaceholderDatabaseHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (!host) return true;
  return /^(host|hostname|placeholder|changeme|example|example\.com|your-host|db-host)$/.test(
    host,
  );
}

export function coherenceDatabaseUrl(): string {
  const candidates = [
    process.env.DATA_DATABASE_URL,
    process.env.DATABASE_URL,
    process.env.POSTGRES_URL_NON_POOLING,
    process.env.POSTGRES_PRISMA_URL,
    process.env.POSTGRES_URL,
    process.env.POSTGRES_URL_NO_SSL,
  ];

  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (!value) continue;

    try {
      const url = new URL(value);
      if (!["postgres:", "postgresql:"].includes(url.protocol)) continue;
      if (isPlaceholderDatabaseHost(url.hostname)) continue;
      if (
        process.env.VERCEL === "1" &&
        /^(host|localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0)$/i.test(url.hostname)
      ) {
        continue;
      }
      return value;
    } catch {
      continue;
    }
  }

  return "";
}
