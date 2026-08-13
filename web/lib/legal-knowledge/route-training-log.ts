import "server-only";

import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import type { LlmRouteAdvice } from "./route-llm-advisor";
import type { LlmRoutePlanAdvice } from "./route-llm-planner";
import type { LlmRouteRerankAdvice } from "./route-llm-rerank";
import type { RouteArbitration, RouteHitSet } from "./route-types";
import type { WikiAnswerPayload } from "@/lib/wiki/answer-types";

export type SatnavTrainingRecord = {
  recordedAt: string;
  query: string;
  searchRouteMode: "satnav";
  /** Planned routes and retrieval results (teacher signal for future fine-tuning). */
  routes: Array<{
    id: string;
    label: string;
    query: string;
    taxonomySlug?: string;
    topScore: number;
    latencyMs: number;
    wikiHitTitles: string[];
    wikiHitIds: string[];
  }>;
  /** Rule-based arbiter (baseline). */
  arbiter: {
    decision: RouteArbitration["decision"];
    chosenRouteIds: string[];
    rationale: string;
    confidence: number;
    routesConsidered: RouteArbitration["routesConsidered"];
  };
  /** LLM route advisor (when invoked). */
  llmAdvisor: LlmRouteAdvice | null;
  /** LLM per-stage traces (when SATNAV_LLM_EACH_STAGE). */
  llmStages?: {
    planner: LlmRoutePlanAdvice | null;
    rerank: LlmRouteRerankAdvice[];
    advisor: LlmRouteAdvice | null;
  };
  /** What we actually used for synthesis. */
  final: {
    decision: RouteArbitration["decision"];
    chosenRouteIds: string[];
    rationale: string;
    decidedBy: "arbiter" | "llm" | "llm_fallback_arbiter";
  };
  synthesis: {
    used: "llm" | "deterministic" | "none";
    answerLength: number;
    answerPreview: string;
    deterministicAnswer?: string;
    llmAnswer?: string;
    llmError?: string;
    sourceTitles: string[];
  };
  latencyMs?: number;
};

function trainingLogEnabled(): boolean {
  const raw = process.env.SATNAV_TRAINING_LOG?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "no") return false;
  return true;
}

function trainingLogPath(): string {
  const custom = process.env.SATNAV_TRAINING_LOG_PATH?.trim();
  if (custom) return custom;
  return path.join(process.cwd(), "reports/satnav-training/routes.jsonl");
}

/** Append one satnav trace for future model training (JSONL). */
export function logSatnavTrainingRecord(record: SatnavTrainingRecord): void {
  if (!trainingLogEnabled()) return;

  try {
    const filePath = trainingLogPath();
    mkdirSync(path.dirname(filePath), { recursive: true });
    appendFileSync(filePath, `${JSON.stringify(record)}\n`, "utf8");
  } catch (err) {
    console.warn("[satnav.training-log] write failed:", err);
  }

  console.info(
    JSON.stringify({
      event: "satnav_training_record",
      queryLen: record.query.length,
      arbiter: record.arbiter.chosenRouteIds,
      llm: record.llmAdvisor?.chosenRouteIds ?? null,
      final: record.final.chosenRouteIds,
      decidedBy: record.final.decidedBy,
      synthesis: record.synthesis.used,
      logPath: trainingLogPath(),
    }),
  );
}

export function buildSatnavTrainingRecord(args: {
  query: string;
  hitSets: RouteHitSet[];
  arbiter: RouteArbitration;
  llmAdvisor: LlmRouteAdvice | null;
  llmPlanner?: LlmRoutePlanAdvice | null;
  llmReranks?: LlmRouteRerankAdvice[];
  finalDecision: SatnavTrainingRecord["final"];
  wikiPayload?: WikiAnswerPayload | null;
  sourceTitles: string[];
  latencyMs?: number;
}): SatnavTrainingRecord {
  const answer = args.wikiPayload?.answer ?? "";
  return {
    recordedAt: new Date().toISOString(),
    query: args.query,
    searchRouteMode: "satnav",
    routes: args.hitSets.map((hs) => ({
      id: hs.route.id,
      label: hs.route.label,
      query: hs.route.query,
      taxonomySlug: hs.route.taxonomySlug,
      topScore: hs.topScore,
      latencyMs: hs.latencyMs,
      wikiHitTitles: hs.wikiHits.slice(0, 6).map((h) => h.title),
      wikiHitIds: hs.wikiHits.slice(0, 6).map((h) => h.id),
    })),
    arbiter: {
      decision: args.arbiter.decision,
      chosenRouteIds: args.arbiter.chosenRouteIds,
      rationale: args.arbiter.rationale,
      confidence: args.arbiter.confidence,
      routesConsidered: args.arbiter.routesConsidered,
    },
    llmAdvisor: args.llmAdvisor,
    llmStages: {
      planner: args.llmPlanner ?? null,
      rerank: args.llmReranks ?? [],
      advisor: args.llmAdvisor,
    },
    final: args.finalDecision,
    synthesis: {
      used: args.wikiPayload?.synthesisMeta?.used ?? (answer ? "deterministic" : "none"),
      answerLength: answer.length,
      answerPreview: answer.slice(0, 400),
      deterministicAnswer: args.wikiPayload?.synthesisMeta?.deterministicAnswer?.slice(0, 2000),
      llmAnswer: args.wikiPayload?.synthesisMeta?.llmAnswer?.slice(0, 2000),
      llmError: args.wikiPayload?.synthesisMeta?.llmError,
      sourceTitles: args.sourceTitles.slice(0, 12),
    },
    latencyMs: args.latencyMs,
  };
}
