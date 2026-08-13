import "server-only";

import { enableLlmAnswer, resolveSynthesisModel } from "@/lib/llm/answer-config";
import { chat, llmConfigured } from "@/lib/llm/client";

import { satnavLlmEachStageEnabled } from "./route-llm-config";
import type { RouteHitSet } from "./route-types";

export type LlmRouteRerankAdvice = {
  routeId: string;
  rankedHitIds: string[];
  rationale: string;
  model?: string;
  latencyMs: number;
  error?: string;
};

type LlmRerankJson = {
  routes?: Array<{
    routeId?: string;
    rankedHitIds?: string[];
    rationale?: string;
  }>;
};

const RERANK_SYSTEM = `You rerank wiki page hits for UK legal signposting.

Given a citizen question and per-route wiki hits, order hit ids by relevance to the citizen's actual issue.

Output JSON only:
{
  "routes": [
    {
      "routeId": "route_id",
      "rankedHitIds": ["wiki_page_id", "..."],
      "rationale": "short reason"
    }
  ]
}

Rules:
- rankedHitIds must only use ids from that route's provided hit list.
- Put the most relevant page first (e.g. Trading Standards for unsafe marketplace products).
- Include every provided id unless clearly irrelevant; omit only obvious noise.`;

function parseRerankJson(
  raw: string,
  hitIdsByRoute: Map<string, Set<string>>,
): Omit<LlmRouteRerankAdvice, "latencyMs" | "model">[] {
  let parsed: LlmRerankJson;
  try {
    parsed = JSON.parse(raw) as LlmRerankJson;
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return [];
    try {
      parsed = JSON.parse(match[0]) as LlmRerankJson;
    } catch {
      return [];
    }
  }

  const out: Omit<LlmRouteRerankAdvice, "latencyMs" | "model">[] = [];
  for (const row of parsed.routes ?? []) {
    const routeId = String(row.routeId ?? "").trim();
    const valid = hitIdsByRoute.get(routeId);
    if (!valid) continue;

    const rankedHitIds = (row.rankedHitIds ?? [])
      .map((id) => String(id).trim())
      .filter((id) => valid.has(id));

    // Append any missing ids in original order
    for (const id of valid) {
      if (!rankedHitIds.includes(id)) rankedHitIds.push(id);
    }

    if (!rankedHitIds.length) continue;
    out.push({
      routeId,
      rankedHitIds,
      rationale: (row.rationale ?? "LLM rerank").slice(0, 300),
    });
  }
  return out;
}

export function satnavLlmRerankEnabled(): boolean {
  if (!satnavLlmEachStageEnabled()) return false;
  return llmConfigured() && enableLlmAnswer();
}

function buildRerankPrompt(query: string, hitSets: RouteHitSet[]): string {
  const blocks = hitSets
    .filter((hs) => hs.wikiHits.length > 0)
    .map((hs) => {
      const hits = hs.wikiHits.slice(0, 6).map((h) => `  - id=${h.id} | ${h.title}`);
      return `Route id: ${hs.route.id}\nLabel: ${hs.route.label}\nHits:\n${hits.join("\n")}`;
    });
  return `CITIZEN QUESTION:\n${query.slice(0, 1000)}\n\nROUTES AND HITS:\n\n${blocks.join("\n\n---\n\n")}\n\nRespond with JSON only.`;
}

/** LLM stage 2: rerank wiki hits within each route after retrieval. */
export async function rerankRouteHitsWithLlm(
  query: string,
  hitSets: RouteHitSet[],
): Promise<{ hitSets: RouteHitSet[]; reranks: LlmRouteRerankAdvice[] }> {
  if (!satnavLlmRerankEnabled()) return { hitSets, reranks: [] };

  const withHits = hitSets.filter((hs) => hs.wikiHits.length > 1);
  if (!withHits.length) return { hitSets, reranks: [] };

  const hitIdsByRoute = new Map<string, Set<string>>();
  for (const hs of withHits) {
    hitIdsByRoute.set(
      hs.route.id,
      new Set(hs.wikiHits.map((h) => h.id)),
    );
  }

  const t0 = Date.now();
  const model = resolveSynthesisModel();

  try {
    const raw = await chat(
      [
        { role: "system", content: RERANK_SYSTEM },
        { role: "user", content: buildRerankPrompt(query, withHits) },
      ],
      { jsonMode: true, temperature: 0.05, maxTokens: 700, model },
    );

    const parsed = parseRerankJson(raw, hitIdsByRoute);
    const latencyMs = Date.now() - t0;

    if (!parsed.length) {
      return {
        hitSets,
        reranks: [
          {
            routeId: "*",
            rankedHitIds: [],
            rationale: "LLM rerank returned invalid JSON",
            model,
            latencyMs,
            error: "invalid_json",
          },
        ],
      };
    }

    const rerankByRoute = new Map(parsed.map((r) => [r.routeId, r]));
    const nextHitSets = hitSets.map((hs) => {
      const advice = rerankByRoute.get(hs.route.id);
      if (!advice) return hs;

      const byId = new Map(hs.wikiHits.map((h) => [h.id, h]));
      const reordered = advice.rankedHitIds
        .map((id) => byId.get(id))
        .filter(Boolean) as typeof hs.wikiHits;
      const topScore = reordered[0]?.score ?? hs.topScore;

      return { ...hs, wikiHits: reordered, topScore };
    });

    const reranks: LlmRouteRerankAdvice[] = parsed.map((r) => ({
      ...r,
      model,
      latencyMs,
    }));

    return { hitSets: nextHitSets, reranks };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      hitSets,
      reranks: [
        {
          routeId: "*",
          rankedHitIds: [],
          rationale: "LLM rerank failed",
          model,
          latencyMs: Date.now() - t0,
          error: message.slice(0, 300),
        },
      ],
    };
  }
}
