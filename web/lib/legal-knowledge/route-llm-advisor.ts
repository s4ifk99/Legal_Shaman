import "server-only";

import { enableLlmAnswer, resolveSynthesisModel } from "@/lib/llm/answer-config";
import { chat, llmConfigured } from "@/lib/llm/client";

import { satnavLlmEachStageEnabled } from "./route-llm-config";

import type { RouteDecisionMode, RouteHitSet } from "./route-types";

export type LlmRouteAdvice = {
  decision: RouteDecisionMode;
  chosenRouteIds: string[];
  rationale: string;
  confidence: number;
  model?: string;
  latencyMs: number;
  error?: string;
};

type LlmRouteJson = {
  decision?: string;
  chosenRouteIds?: string[];
  rationale?: string;
  confidence?: number;
};

const ROUTE_ADVISOR_SYSTEM = `You are a UK legal signposting route selector for Legal Shaman.

Given a citizen's question and several search routes (each with wiki page hits), choose the best route(s).

Rules:
- Pick the route whose top wiki pages best match the citizen's actual legal issue.
- For unsafe products / marketplace purchases → prefer Trading Standards / consumer safety routes over housing or tradesperson routes.
- Use "mix" only when two routes cover complementary guidance (e.g. party wall + planning).
- chosenRouteIds must be from the provided route id list only.
- Output valid JSON only:
{
  "decision": "pick" | "mix",
  "chosenRouteIds": ["route_id"],
  "rationale": "one sentence",
  "confidence": 0.0 to 1.0
}`;

export function satnavLlmAdvisorEnabled(): boolean {
  const raw = process.env.SATNAV_LLM_ADVISOR?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "no") return false;
  if (raw === "1" || raw === "true" || raw === "yes") return true;
  if (satnavLlmEachStageEnabled()) return llmConfigured() && enableLlmAnswer();
  return llmConfigured() && enableLlmAnswer();
}

function buildRouteAdvisorPrompt(query: string, hitSets: RouteHitSet[]): string {
  const routes = hitSets.map((hs) => {
    const tops = hs.wikiHits.slice(0, 4).map((h) => h.title);
    return [
      `Route id: ${hs.route.id}`,
      `Label: ${hs.route.label}`,
      `Search query: ${hs.route.query}`,
      `Arbiter score hint: ${hs.topScore}`,
      tops.length ? `Top wiki hits: ${tops.join(" | ")}` : "Top wiki hits: (none)",
    ].join("\n");
  });
  return `CITIZEN QUESTION:\n${query.slice(0, 1200)}\n\nSEARCH ROUTES:\n\n${routes.join("\n\n---\n\n")}\n\nRespond with JSON only.`;
}

function parseRouteAdviceJson(raw: string, validIds: Set<string>): Omit<LlmRouteAdvice, "latencyMs" | "model"> | null {
  let parsed: LlmRouteJson;
  try {
    parsed = JSON.parse(raw) as LlmRouteJson;
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      parsed = JSON.parse(match[0]) as LlmRouteJson;
    } catch {
      return null;
    }
  }

  const decision: RouteDecisionMode =
    parsed.decision?.toLowerCase() === "mix" ? "mix" : "pick";
  const chosenRouteIds = (parsed.chosenRouteIds ?? [])
    .map((id) => String(id).trim())
    .filter((id) => validIds.has(id));
  if (!chosenRouteIds.length) return null;

  const confidence = Number(parsed.confidence);
  return {
    decision: decision === "mix" && chosenRouteIds.length < 2 ? "pick" : decision,
    chosenRouteIds: decision === "mix" ? chosenRouteIds.slice(0, 2) : chosenRouteIds.slice(0, 1),
    rationale: (parsed.rationale ?? "LLM route selection").slice(0, 400),
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.5,
  };
}

/** Ask the LLM which satnav route(s) best match the citizen question. */
export async function adviseRoutesWithLlm(
  query: string,
  hitSets: RouteHitSet[],
): Promise<LlmRouteAdvice | null> {
  if (!satnavLlmAdvisorEnabled() || !hitSets.length) return null;

  const validIds = new Set(hitSets.map((h) => h.route.id));
  const t0 = Date.now();
  const model = resolveSynthesisModel();

  try {
    const raw = await chat(
      [
        { role: "system", content: ROUTE_ADVISOR_SYSTEM },
        { role: "user", content: buildRouteAdvisorPrompt(query, hitSets) },
      ],
      {
        jsonMode: true,
        temperature: 0.1,
        maxTokens: process.env.VERCEL === "1" ? 280 : 400,
        model,
      },
    );

    const parsed = parseRouteAdviceJson(raw, validIds);
    if (!parsed) {
      return {
        decision: "pick",
        chosenRouteIds: [],
        rationale: "LLM returned invalid route advice JSON",
        confidence: 0,
        model,
        latencyMs: Date.now() - t0,
        error: "invalid_json",
      };
    }

    return { ...parsed, model, latencyMs: Date.now() - t0 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      decision: "pick",
      chosenRouteIds: [],
      rationale: "LLM route advisor failed",
      confidence: 0,
      model,
      latencyMs: Date.now() - t0,
      error: message.slice(0, 300),
    };
  }
}
