import { enableLlmAnswer, llmAnswerEnvIssues, resolveSynthesisModel } from "@/lib/llm/answer-config";
import { chat, llmConfigured } from "@/lib/llm/client";
import { isOpenRouterBaseUrl, resolveLlmApiKey, resolveLlmBaseUrl } from "@/lib/llm/openrouter";
import { directorySearchBackend } from "@/lib/legal-search/config";
import { runLegalKnowledgeSearch } from "@/lib/legal-knowledge/search";
import { prisma } from "@/lib/db/prisma";
import { typesenseListingsReachable } from "@/lib/search/typesense-listings";
import { writeOpsJobRun, type OpsJobRunRecord } from "@/lib/ops/job-state";

export type GuidanceAuditCheck = {
  name: string;
  ok: boolean;
  critical: boolean;
  detail?: string;
};

export type AnswerModeMix = {
  total: number;
  synthesis: number;
  graph_assembly: number;
  fallback: number;
  other: number;
  fallbackRate: number | null;
};

export type GuidanceSelfAuditReport = {
  ok: boolean;
  criticalOk: boolean;
  startedAt: string;
  completedAt: string;
  checks: GuidanceAuditCheck[];
  answerModeMix24h: AnswerModeMix;
  llmConfigured: boolean;
  llmAnswerEnabled: boolean;
  llmReachable: boolean | null;
  synthesisModel: string;
};

const OFF_TOPIC_MARKERS = /\b(sponsor licence|skilled worker)\b/i;
const CANARY_QUERY = "need to get a prenup";

let llmReachableCache: { at: number; ok: boolean; detail?: string } | null = null;
const LLM_PING_CACHE_MS = 5 * 60 * 1000;

export function llmAnswerEnabled(): boolean {
  return enableLlmAnswer();
}

export async function pingOpenRouter(force = false): Promise<{ ok: boolean; detail?: string }> {
  if (!force && llmReachableCache && Date.now() - llmReachableCache.at < LLM_PING_CACHE_MS) {
    return { ok: llmReachableCache.ok, detail: llmReachableCache.detail };
  }

  if (!llmConfigured()) {
    const result = { ok: false, detail: "LLM_API_KEY not configured" };
    llmReachableCache = { at: Date.now(), ...result };
    return result;
  }

  try {
    const text = await chat(
      [
        { role: "system", content: "Reply with the single word pong." },
        { role: "user", content: "ping" },
      ],
      { maxTokens: 8, temperature: 0, model: resolveSynthesisModel() },
    );
    const ok = /\w/.test(text);
    const result = { ok, detail: ok ? `model=${resolveSynthesisModel()}` : "empty response" };
    llmReachableCache = { at: Date.now(), ...result };
    return result;
  } catch (e) {
    const result = {
      ok: false,
      detail: e instanceof Error ? e.message.slice(0, 240) : String(e),
    };
    llmReachableCache = { at: Date.now(), ...result };
    return result;
  }
}

export async function getCachedLlmReachable(): Promise<boolean | null> {
  if (!llmConfigured()) return false;
  if (llmReachableCache && Date.now() - llmReachableCache.at < LLM_PING_CACHE_MS) {
    return llmReachableCache.ok;
  }
  const ping = await pingOpenRouter();
  return ping.ok;
}

export async function answerModeMixLast24h(): Promise<AnswerModeMix> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  let rows: { extractedFilters: unknown }[] = [];
  try {
    rows = await prisma.searchInteraction.findMany({
      where: {
        channel: "legal_knowledge",
        createdAt: { gte: since },
      },
      select: { extractedFilters: true },
      take: 2000,
    });
  } catch {
    return {
      total: 0,
      synthesis: 0,
      graph_assembly: 0,
      fallback: 0,
      other: 0,
      fallbackRate: null,
    };
  }

  const mix: AnswerModeMix = {
    total: rows.length,
    synthesis: 0,
    graph_assembly: 0,
    fallback: 0,
    other: 0,
    fallbackRate: null,
  };

  for (const row of rows) {
    const filters = row.extractedFilters as { answerMode?: string } | null;
    const mode = filters?.answerMode ?? "other";
    if (mode === "synthesis") mix.synthesis += 1;
    else if (mode === "graph_assembly") mix.graph_assembly += 1;
    else if (mode === "fallback") mix.fallback += 1;
    else mix.other += 1;
  }

  mix.fallbackRate = mix.total > 0 ? mix.fallback / mix.total : null;
  return mix;
}

async function checkEnv(): Promise<GuidanceAuditCheck> {
  const issues = llmAnswerEnvIssues();
  const base = resolveLlmBaseUrl();
  const detailParts = [
    `base=${base}`,
    `openrouter=${isOpenRouterBaseUrl(base)}`,
    `enableLlmAnswer=${enableLlmAnswer()}`,
    `key=${resolveLlmApiKey() ? "set" : "missing"}`,
  ];
  if (issues.length) {
    return {
      name: "env",
      ok: false,
      critical: true,
      detail: `${issues.join("; ")} (${detailParts.join(", ")})`,
    };
  }
  return {
    name: "env",
    ok: true,
    critical: true,
    detail: detailParts.join(", "),
  };
}

async function checkOpenRouterPing(): Promise<GuidanceAuditCheck> {
  const ping = await pingOpenRouter(true);
  return {
    name: "openrouter_ping",
    ok: ping.ok,
    critical: true,
    detail: ping.detail,
  };
}

async function checkCanary(): Promise<GuidanceAuditCheck> {
  try {
    const result = await runLegalKnowledgeSearch({ query: CANARY_QUERY });
    const mode = result.answerMode ?? "unknown";
    const answer = (result.answer ?? "").toLowerCase();
    const modeOk = mode === "synthesis" || mode === "graph_assembly";
    const offTopic = OFF_TOPIC_MARKERS.test(answer);
    const onTopic =
      /\b(prenup|prenuptial|nuptial|marriage)\b/i.test(answer) ||
      mode === "synthesis";

    if (!modeOk) {
      return {
        name: "canary_prenup",
        ok: false,
        critical: true,
        detail: `answerMode=${mode} (want synthesis|graph_assembly)`,
      };
    }
    if (offTopic) {
      return {
        name: "canary_prenup",
        ok: false,
        critical: true,
        detail: `off-topic markers in answer (mode=${mode})`,
      };
    }
    if (mode === "graph_assembly" && !onTopic) {
      return {
        name: "canary_prenup",
        ok: false,
        critical: true,
        detail: "graph_assembly without prenup/marriage topical content",
      };
    }
    return {
      name: "canary_prenup",
      ok: true,
      critical: true,
      detail: `answerMode=${mode}`,
    };
  } catch (e) {
    return {
      name: "canary_prenup",
      ok: false,
      critical: true,
      detail: e instanceof Error ? e.message.slice(0, 240) : String(e),
    };
  }
}

async function checkTypesense(): Promise<GuidanceAuditCheck> {
  const backend = directorySearchBackend();
  if (backend !== "typesense") {
    return {
      name: "typesense",
      ok: true,
      critical: false,
      detail: `skipped (directory backend=${backend})`,
    };
  }
  const reachable = await typesenseListingsReachable();
  return {
    name: "typesense",
    ok: reachable,
    critical: false,
    detail: reachable ? "reachable" : "typesenseListingsReachable=false",
  };
}

async function checkAnswerModeSlo(mix: AnswerModeMix): Promise<GuidanceAuditCheck> {
  if (!llmConfigured() || !enableLlmAnswer()) {
    return {
      name: "answer_mode_slo",
      ok: true,
      critical: false,
      detail: "skipped (LLM answer not fully configured)",
    };
  }
  if (mix.total < 5) {
    return {
      name: "answer_mode_slo",
      ok: true,
      critical: false,
      detail: `insufficient samples (n=${mix.total})`,
    };
  }
  const rate = mix.fallbackRate ?? 0;
  const ok = rate < 0.4;
  return {
    name: "answer_mode_slo",
    ok,
    critical: false,
    detail: `fallbackRate=${(rate * 100).toFixed(1)}% (n=${mix.total}; synth=${mix.synthesis} graph=${mix.graph_assembly} fallback=${mix.fallback})`,
  };
}

export async function runGuidanceSelfAudit(options?: {
  skipCanary?: boolean;
}): Promise<GuidanceSelfAuditReport> {
  const startedAt = new Date().toISOString();
  const mix = await answerModeMixLast24h();

  const checks: GuidanceAuditCheck[] = [
    await checkEnv(),
    await checkOpenRouterPing(),
  ];

  if (!options?.skipCanary) {
    checks.push(await checkCanary());
  } else {
    checks.push({
      name: "canary_prenup",
      ok: true,
      critical: true,
      detail: "skipped",
    });
  }

  checks.push(await checkTypesense());
  checks.push(await checkAnswerModeSlo(mix));

  const criticalOk = checks.filter((c) => c.critical).every((c) => c.ok);
  const ok = checks.every((c) => c.ok);
  const llmReachable = checks.find((c) => c.name === "openrouter_ping")?.ok ?? null;

  const report: GuidanceSelfAuditReport = {
    ok,
    criticalOk,
    startedAt,
    completedAt: new Date().toISOString(),
    checks,
    answerModeMix24h: mix,
    llmConfigured: llmConfigured(),
    llmAnswerEnabled: enableLlmAnswer(),
    llmReachable,
    synthesisModel: resolveSynthesisModel(),
  };

  console.info(
    JSON.stringify({
      event: "guidance_self_audit",
      ok: report.ok,
      criticalOk: report.criticalOk,
      checks: report.checks.map((c) => ({
        name: c.name,
        ok: c.ok,
        critical: c.critical,
        detail: c.detail,
      })),
      answerModeMix24h: mix,
      llmAnswerEnabled: report.llmAnswerEnabled,
      synthesisModel: report.synthesisModel,
    }),
  );

  const record: OpsJobRunRecord = {
    status: report.criticalOk ? "completed" : "failed",
    startedAt: report.startedAt,
    completedAt: report.completedAt,
    steps: report.checks.map((c) => ({
      name: c.name,
      ok: c.ok,
      detail: c.detail,
    })),
    errors: report.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail ?? "failed"}`),
  };

  try {
    await writeOpsJobRun("guidanceSelfAudit", record);
  } catch {
    // File state may be unavailable on Vercel read-only FS — non-fatal.
  }

  return report;
}
