import "server-only";

import { z } from "zod";

import { chat, llmConfigured } from "@/lib/llm/client";
import {
  COHERENCE_PACK_IDS,
  heuristicSuggestPack,
  isCoherencePackId,
  packClassifySystemPrompt,
  type PackClassification,
} from "./packClassifier";

const Schema = z.object({
  packId: z.string(),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
  clarifyingQuestion: z.string().nullable().optional(),
});

export function enablePackClassifyLlm(): boolean {
  const raw = process.env.ENABLE_COHERENCE_PACK_CLASSIFY?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  return llmConfigured();
}

/**
 * OpenRouter JSON pack classifier for Coherence intake openers.
 * Falls back to heuristics when LLM is off or fails.
 */
export async function classifyPackWithLlm(
  text: string,
  heuristicHint?: PackClassification,
): Promise<PackClassification> {
  const fallback = heuristicHint ?? heuristicSuggestPack(text);
  if (!enablePackClassifyLlm()) return fallback;

  try {
    const content = await chat(
      [
        { role: "system", content: packClassifySystemPrompt() },
        {
          role: "user",
          content: `Heuristic hint: ${fallback.packId} (conf ${fallback.confidence.toFixed(2)}) — ${fallback.reason}\n\nClient message:\n${text.slice(0, 1200)}`,
        },
      ],
      {
        jsonMode: true,
        temperature: 0.1,
        maxTokens: 220,
        model:
          process.env.LLM_SMALL_MODEL?.trim() ||
          process.env.OPENROUTER_MODEL?.trim() ||
          undefined,
        purpose: "pack_classify",
        caller: "coherence.packClassify",
      },
    );

    const parsed = Schema.safeParse(JSON.parse(content));
    if (!parsed.success) return fallback;

    const packId = parsed.data.packId.trim().toLowerCase();
    if (!isCoherencePackId(packId)) return fallback;

    return {
      packId,
      confidence: parsed.data.confidence,
      reason: parsed.data.reason.trim().slice(0, 240) || fallback.reason,
      clarifyingQuestion:
        parsed.data.clarifyingQuestion?.trim().slice(0, 280) ||
        (packId === "unclear" ? fallback.clarifyingQuestion : undefined),
      source: "llm",
    };
  } catch {
    return fallback;
  }
}

export function packIdListForPrompt(): string {
  return COHERENCE_PACK_IDS.join(", ");
}
