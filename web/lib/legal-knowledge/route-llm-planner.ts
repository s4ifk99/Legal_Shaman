import "server-only";

import { enableLlmAnswer, resolveSynthesisModel } from "@/lib/llm/answer-config";
import { chat, llmConfigured } from "@/lib/llm/client";

import { satnavLlmEachStageEnabled } from "./route-llm-config";
import type { LegalSearchIntent } from "./search-intent";
import type { SearchRoute } from "./route-types";

export type LlmRoutePlanAdvice = {
  refinedQueries: Array<{ routeId: string; query: string }>;
  addedRoutes: SearchRoute[];
  rationale: string;
  model?: string;
  latencyMs: number;
  error?: string;
};

type LlmPlanJson = {
  refinedQueries?: Array<{ routeId?: string; query?: string }>;
  extraRoutes?: Array<{
    id?: string;
    label?: string;
    query?: string;
    taxonomySlug?: string;
  }>;
  rationale?: string;
};

const PLANNER_SYSTEM = `You refine UK legal wiki search routes for Legal Shaman signposting.

Given a citizen question and existing routes, return JSON only:
{
  "refinedQueries": [{"routeId": "existing_id", "query": "better wiki search phrase max 160 chars"}],
  "extraRoutes": [{"id": "llm:topic", "label": "short label", "query": "wiki search phrase", "taxonomySlug": "optional_slug"}],
  "rationale": "one sentence"
}

Rules:
- refinedQueries.routeId must match an existing route id only.
- extraRoutes: at most 1 additional route; id must start with "llm:".
- Prefer Trading Standards / product safety for marketplace unsafe goods.
- Do not invent route ids outside existing list except one llm: extra route.`;

function parsePlanJson(raw: string, validIds: Set<string>): Omit<LlmRoutePlanAdvice, "latencyMs" | "model"> | null {
  let parsed: LlmPlanJson;
  try {
    parsed = JSON.parse(raw) as LlmPlanJson;
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      parsed = JSON.parse(match[0]) as LlmPlanJson;
    } catch {
      return null;
    }
  }

  const refinedQueries = (parsed.refinedQueries ?? [])
    .map((r) => ({
      routeId: String(r.routeId ?? "").trim(),
      query: String(r.query ?? "").trim().slice(0, 160),
    }))
    .filter((r) => validIds.has(r.routeId) && r.query.length >= 8);

  const addedRoutes: SearchRoute[] = (parsed.extraRoutes ?? [])
    .slice(0, 1)
    .map((r) => {
      const id = String(r.id ?? "llm:extra").trim();
      const query = String(r.query ?? "").trim().slice(0, 160);
      if (!id.startsWith("llm:") || query.length < 8) return null;
      return {
        id,
        label: String(r.label ?? "LLM suggested route").trim().slice(0, 80),
        query,
        taxonomySlug: r.taxonomySlug?.trim() || undefined,
        signals: ["llm:planner"],
      } satisfies SearchRoute;
    })
    .filter(Boolean) as SearchRoute[];

  return {
    refinedQueries,
    addedRoutes,
    rationale: (parsed.rationale ?? "LLM route plan").slice(0, 400),
  };
}

export function satnavLlmPlannerEnabled(): boolean {
  if (!satnavLlmEachStageEnabled()) return false;
  return llmConfigured() && enableLlmAnswer();
}

/** LLM stage 1: refine route search queries and optionally add one route. */
export async function planRoutesWithLlm(args: {
  query: string;
  intent: LegalSearchIntent;
  baseRoutes: SearchRoute[];
}): Promise<LlmRoutePlanAdvice | null> {
  if (!satnavLlmPlannerEnabled() || !args.baseRoutes.length) return null;

  const validIds = new Set(args.baseRoutes.map((r) => r.id));
  const routeList = args.baseRoutes
    .map((r) => `id=${r.id} label="${r.label}" query="${r.query}"`)
    .join("\n");
  const t0 = Date.now();
  const model = resolveSynthesisModel();

  try {
    const raw = await chat(
      [
        { role: "system", content: PLANNER_SYSTEM },
        {
          role: "user",
          content: `CITIZEN QUESTION:\n${args.query.slice(0, 1000)}\n\nTAXONOMY HINT: ${args.intent.taxonomySlug ?? "unknown"}\n\nEXISTING ROUTES:\n${routeList}\n\nRespond with JSON only.`,
        },
      ],
      { jsonMode: true, temperature: 0.1, maxTokens: 420, model },
    );

    const parsed = parsePlanJson(raw, validIds);
    if (!parsed) {
      return {
        refinedQueries: [],
        addedRoutes: [],
        rationale: "LLM planner returned invalid JSON",
        model,
        latencyMs: Date.now() - t0,
        error: "invalid_json",
      };
    }

    return { ...parsed, model, latencyMs: Date.now() - t0 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      refinedQueries: [],
      addedRoutes: [],
      rationale: "LLM route planner failed",
      model,
      latencyMs: Date.now() - t0,
      error: message.slice(0, 300),
    };
  }
}

export function applyLlmRoutePlan(
  baseRoutes: SearchRoute[],
  plan: LlmRoutePlanAdvice | null,
  cap: number,
): SearchRoute[] {
  if (!plan || plan.error === "invalid_json") return baseRoutes;

  const routes = baseRoutes.map((r) => {
    const ref = plan.refinedQueries.find((q) => q.routeId === r.id);
    return ref ? { ...r, query: ref.query, signals: [...r.signals, "llm:refined_query"] } : r;
  });

  for (const extra of plan.addedRoutes) {
    if (!routes.some((r) => r.id === extra.id)) routes.push(extra);
  }

  return routes.slice(0, cap);
}
