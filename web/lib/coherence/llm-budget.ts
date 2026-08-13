/**
 * Coherence LLM budget — shared across MJS agents and TS Overview via process global.
 *
 * Principle: No subagent may call the frontier LLM merely to reinterpret
 * information already present in MatterFrame.
 *
 * Target: 2 OpenRouter calls per submission
 *   1. matter_resolution
 *   2. final_synthesis
 */
export type LlmCallReason =
  | "matter_resolution"
  | "final_synthesis"
  | "blocking_ambiguity_replan"
  | "evidence_research_exception"
  | "blocking_ambiguity_after_retrieval"
  | "evidence_replan"
  | "legacy_brief"
  | "legacy_taxonomy"
  | "legacy_timeline"
  | "legacy_ask"
  | "legacy_answer"
  | "legacy_overview"
  | "legacy_critic"
  | "legacy_help_match"
  | "legacy_other"
  | "compile_wiki";

export type LlmBudgetPolicy = {
  normalMax: number;
  exceptionalMax: number;
  exceptionalReasons: LlmCallReason[];
};

export const DEFAULT_LLM_BUDGET_POLICY: LlmBudgetPolicy = {
  normalMax: 2,
  exceptionalMax: 3,
  exceptionalReasons: [
    "blocking_ambiguity_replan",
    "evidence_research_exception",
    "blocking_ambiguity_after_retrieval",
    "evidence_replan",
  ],
};

export type LlmCallRecord = {
  purpose: LlmCallReason;
  caller: string;
  model: string;
  attempt: number;
  ok: boolean;
  latencyMs: number;
  inputChars: number;
  outputChars: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostUsd: number;
  retryReason?: string;
  error?: string;
  at: string;
};

export type LlmBudget = {
  requestId: string;
  normalMax: number;
  exceptionalMax: number;
  maxCalls: number;
  hard: boolean;
  callsUsed: number;
  records: LlmCallRecord[];
};

const GLOBAL_KEY = "__coherenceLlmBudget";

type GlobalBudgetStore = { active: LlmBudget | null };

function store(): GlobalBudgetStore {
  const g = globalThis as typeof globalThis & { [GLOBAL_KEY]?: GlobalBudgetStore };
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = { active: null };
  return g[GLOBAL_KEY];
}

const HARD_PERMITTED: Set<LlmCallReason> = new Set([
  "matter_resolution",
  "final_synthesis",
  "blocking_ambiguity_replan",
  "evidence_research_exception",
  "blocking_ambiguity_after_retrieval",
  "evidence_replan",
]);

const COST_PER_1K_INPUT = 0.00015;
const COST_PER_1K_OUTPUT = 0.0006;

export function estimateTokensFromChars(chars: number): number {
  return Math.max(1, Math.ceil(chars / 4));
}

export function estimateCostUsd(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1000) * COST_PER_1K_INPUT + (outputTokens / 1000) * COST_PER_1K_OUTPUT;
}

export function beginLlmBudget(opts?: {
  requestId?: string;
  maxCalls?: number;
  normalMax?: number;
  exceptionalMax?: number;
  hard?: boolean;
}): LlmBudget {
  const s = store();
  if (s.active) return s.active;
  const policy = DEFAULT_LLM_BUDGET_POLICY;
  const normalFromEnv = Number(process.env.COHERENCE_LLM_MAX_CALLS || String(policy.normalMax));
  const exceptionalFromEnv = Number(
    process.env.COHERENCE_LLM_EXCEPTIONAL_MAX || String(policy.exceptionalMax),
  );
  const normalMax = opts?.normalMax ?? (Number.isFinite(normalFromEnv) ? normalFromEnv : policy.normalMax);
  const exceptionalMax =
    opts?.exceptionalMax ??
    (Number.isFinite(exceptionalFromEnv) ? exceptionalFromEnv : policy.exceptionalMax);
  s.active = {
    requestId: opts?.requestId || `llm-${Date.now().toString(36)}`,
    normalMax,
    exceptionalMax,
    maxCalls: opts?.maxCalls ?? exceptionalMax,
    hard: opts?.hard ?? process.env.COHERENCE_LLM_BUDGET_HARD === "1",
    callsUsed: 0,
    records: [],
  };
  return s.active;
}

export function getLlmBudget(): LlmBudget | null {
  return store().active;
}

export function endLlmBudget(): LlmBudget | null {
  const s = store();
  const b = s.active;
  s.active = null;
  return b;
}

export function formatLlmTrace(budget: LlmBudget): string {
  const byPurpose = new Map<string, number>();
  for (const r of budget.records) {
    byPurpose.set(r.purpose, (byPurpose.get(r.purpose) || 0) + 1);
  }
  const retries = budget.records.filter((r) => r.attempt > 1 || r.retryReason).length;
  const totalIn = budget.records.reduce((s, r) => s + r.estimatedInputTokens, 0);
  const totalOut = budget.records.reduce((s, r) => s + r.estimatedOutputTokens, 0);
  const totalCost = budget.records.reduce((s, r) => s + r.estimatedCostUsd, 0);
  const overNormal = budget.callsUsed > budget.normalMax;
  const overExceptional = budget.callsUsed > budget.exceptionalMax;
  const lines = [
    "[coherence-cost]",
    `requestId: ${budget.requestId}`,
    `frontierCalls: ${budget.callsUsed} (normal≤${budget.normalMax}, exceptional≤${budget.exceptionalMax}${budget.hard ? ", hard" : ", soft"})`,
    `frontierTokens: ~${totalIn}+${totalOut}`,
    `frontierCost: ~$${totalCost.toFixed(4)}`,
    `retries: ${retries}`,
    "",
    "By purpose:",
    ...[...byPurpose.entries()].map(([p, n]) => `  ${p.padEnd(28)} ${n}`),
    "",
    "Calls:",
  ];
  budget.records.forEach((r, i) => {
    const retryTag = r.attempt > 1 || r.retryReason ? ` [retry:${r.retryReason || r.attempt}]` : "";
    lines.push(
      `${i + 1}. ${r.purpose}  (${r.caller})  ${r.latencyMs}ms  ~${r.estimatedInputTokens}+${r.estimatedOutputTokens} tok  ~$${r.estimatedCostUsd.toFixed(4)}${r.ok ? "" : " FAIL"}${retryTag}`,
    );
  });
  lines.push("");
  lines.push(`Estimated total: $${totalCost.toFixed(4)}`);
  if (overNormal && !overExceptional) {
    lines.push(`OVER NORMAL BUDGET by ${budget.callsUsed - budget.normalMax} call(s) — exceptional if justified`);
  }
  if (overExceptional) {
    lines.push(`DEFECT: over exceptional budget by ${budget.callsUsed - budget.exceptionalMax} call(s)`);
  }
  return lines.join("\n");
}

export function gateLlmCall(
  purpose: LlmCallReason,
  caller: string,
): { allowed: boolean; warn?: string } {
  const active = store().active;
  if (!active) {
    return { allowed: true, warn: "no active LLM budget — call not attributed" };
  }
  const next = active.callsUsed + 1;
  const legacy = purpose.startsWith("legacy_");
  const exceptional = DEFAULT_LLM_BUDGET_POLICY.exceptionalReasons.includes(purpose);
  if (active.hard) {
    if (!HARD_PERMITTED.has(purpose)) {
      return {
        allowed: false,
        warn: `hard budget rejected ${purpose} from ${caller}`,
      };
    }
    const limit = exceptional ? active.exceptionalMax : active.normalMax;
    if (next > limit && !exceptional) {
      return {
        allowed: false,
        warn: `hard budget exceeded (${next}/${limit}) for ${purpose}`,
      };
    }
    if (next > active.exceptionalMax) {
      return {
        allowed: false,
        warn: `hard exceptional budget exceeded (${next}/${active.exceptionalMax}) for ${purpose}`,
      };
    }
  }
  if (next > active.exceptionalMax || (next > active.normalMax && !exceptional) || legacy) {
    return {
      allowed: true,
      warn: legacy
        ? `legacy LLM call ${purpose} from ${caller} — migrate into matter_resolution / final_synthesis`
        : next > active.exceptionalMax
          ? `soft over exceptional budget ${purpose} (${next}/${active.exceptionalMax}) from ${caller}`
          : `soft over normal budget ${purpose} (${next}/${active.normalMax}) from ${caller}`,
    };
  }
  return { allowed: true };
}

export function recordLlmCall(
  partial: Omit<LlmCallRecord, "at"> & { at?: string },
): LlmCallRecord {
  const record: LlmCallRecord = {
    ...partial,
    at: partial.at || new Date().toISOString(),
  };
  const active = store().active;
  if (active) {
    active.callsUsed += 1;
    active.records.push(record);
  }
  return record;
}
