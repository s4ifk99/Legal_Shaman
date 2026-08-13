import "server-only";

import { enableLlmAnswer } from "@/lib/llm/answer-config";
import { llmConfigured } from "@/lib/llm/client";

/** Run an LLM call at each satnav stage (plan, rerank, arbitrate, synthesize). */
export function satnavLlmEachStageEnabled(): boolean {
  const raw = process.env.SATNAV_LLM_EACH_STAGE?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "no") return false;
  if (raw === "1" || raw === "true" || raw === "yes") return true;
  return llmConfigured() && enableLlmAnswer();
}

export function llmRouteConfidenceMin(): number {
  if (satnavLlmEachStageEnabled()) return 0.4;
  const raw = Number(process.env.SATNAV_LLM_ROUTE_CONFIDENCE_MIN);
  if (Number.isFinite(raw) && raw > 0 && raw <= 1) return raw;
  return 0.55;
}
