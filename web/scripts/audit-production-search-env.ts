/**
 * Compare local search-related env vars against production requirements.
 *
 * Usage: npx tsx scripts/audit-production-search-env.ts
 *        npx tsx scripts/audit-production-search-env.ts --vercel
 */
import "./load-dotenv";
import { execSync } from "node:child_process";

type EnvSpec = {
  name: string;
  required: "critical" | "recommended" | "optional";
  purpose: string;
};

const SEARCH_ENV_SPECS: EnvSpec[] = [
  { name: "DATABASE_URL", required: "critical", purpose: "Neon Postgres — chunks, concept graph, SRA directory FTS fallback" },
  { name: "LLM_API_KEY", required: "critical", purpose: "OpenRouter/API key — LLM classification + answer synthesis fallback" },
  { name: "LLM_BASE_URL", required: "recommended", purpose: "LLM endpoint (e.g. https://openrouter.ai/api/v1)" },
  { name: "LLM_SMALL_MODEL", required: "recommended", purpose: "Fast synthesis model on Vercel (default openai/gpt-4o-mini)" },
  { name: "ENABLE_LLM_ANSWER", required: "recommended", purpose: "Must be true on Vercel for OpenRouter answer synthesis" },
  { name: "ENABLE_LLM_LEGAL_CLASSIFICATION", required: "recommended", purpose: "Hybrid classifier when rule match is weak" },
  { name: "KNOWLEDGE_GRAPH_MODE", required: "recommended", purpose: "primary | shadow | off — wiki graph answers" },
  { name: "TYPESENSE_HOST", required: "recommended", purpose: "Typesense host — aligns prod directory with local dev" },
  { name: "TYPESENSE_API_KEY", required: "recommended", purpose: "Typesense API key" },
  { name: "TYPESENSE_PROTOCOL", required: "optional", purpose: "https for production Typesense" },
  { name: "TYPESENSE_PORT", required: "optional", purpose: "443 for production Typesense" },
  { name: "ENABLE_TYPESENSE_UNIFIED", required: "recommended", purpose: "Use legal_entities collection for directory search" },
  { name: "DIRECTORY_SEARCH_BACKEND", required: "optional", purpose: "typesense | postgres — auto-typesense when host+key set" },
  { name: "USER_SESSION_SECRET", required: "critical", purpose: "Auth session for search signup gate" },
  { name: "NEXT_PUBLIC_TURNSTILE_SITE_KEY", required: "recommended", purpose: "Signup/login CAPTCHA (client)" },
  { name: "TURNSTILE_SECRET_KEY", required: "recommended", purpose: "Signup/login CAPTCHA (server)" },
];

function localPresent(name: string): boolean {
  const v = process.env[name]?.trim();
  return Boolean(v);
}

function fetchVercelProductionKeys(): Set<string> | null {
  try {
    const out = execSync("npx vercel env ls production 2>/dev/null", {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const keys = new Set<string>();
    for (const line of out.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s+/);
      if (m) keys.add(m[1]!);
    }
    return keys.size ? keys : null;
  } catch {
    return null;
  }
}

function main() {
  const checkVercel = process.argv.includes("--vercel");
  const vercelKeys = checkVercel ? fetchVercelProductionKeys() : null;

  const rows = SEARCH_ENV_SPECS.map((spec) => {
    const local = localPresent(spec.name);
    const vercel = vercelKeys ? vercelKeys.has(spec.name) : null;
    return { ...spec, local, vercel };
  });

  const missingLocalCritical = rows.filter((r) => r.required === "critical" && !r.local);
  const missingVercelCritical =
    vercelKeys == null
      ? null
      : rows.filter((r) => r.required === "critical" && r.vercel === false);

  console.info(
    JSON.stringify(
      {
        event: "search_env_audit",
        directoryBackendHint:
          localPresent("TYPESENSE_HOST") && localPresent("TYPESENSE_API_KEY")
            ? "typesense (when host+key set)"
            : "postgres on Vercel unless Typesense configured",
        rows,
        missingLocalCritical: missingLocalCritical.map((r) => r.name),
        missingVercelCritical: missingVercelCritical?.map((r) => r.name) ?? "vercel_cli_unavailable",
        vercelSetup:
          "Set TYPESENSE_HOST, TYPESENSE_API_KEY, ENABLE_TYPESENSE_UNIFIED=true, LLM_API_KEY, LLM_BASE_URL=https://openrouter.ai/api/v1, ENABLE_LLM_ANSWER=true, LLM_SMALL_MODEL=openai/gpt-4o-mini, ENABLE_LLM_LEGAL_CLASSIFICATION=true, KNOWLEDGE_GRAPH_MODE=primary on Vercel production.",
      },
      null,
      2,
    ),
  );

  if (missingLocalCritical.length) process.exitCode = 1;
}

main();
