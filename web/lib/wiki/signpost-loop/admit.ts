import "server-only";

import { chat } from "@/lib/llm/client";
import { isSharedWordCollisionOnly } from "./admit-gates";
import { parseJsonFromLlm, salvageAdmitJudgments } from "./parse-json";
import {
  AdmitJudgmentBatchSchema,
  type AdmitCandidate,
  type AdmitJudgment,
  type SignpostFacet,
} from "./types";

export {
  applyAdmitJudgments,
  candidatesForFacet,
  dropBlockedOrUnknownExa,
  filterOpenExaByAuthority,
  heuristicAdmitJudgments,
  isOfficialVolatileHost,
  isSharedWordCollisionOnly,
} from "./admit-gates";

function smallModel(): string | undefined {
  return (
    process.env.LLM_SMALL_MODEL?.trim() ||
    process.env.LLM_MODEL?.trim() ||
    undefined
  );
}

const ADMIT_SYSTEM = `You judge whether each candidate page proves its assigned facet for UK England and Wales signposting.
Return JSON only: { "judgments": [ { "facetId": "...", "urlOrId": "...", "relevant": true|false, "because": "short" } ] }.
Copy facetId and urlOrId exactly from each candidate.
Keep because under 12 words; no quotes inside because.
relevant=true if the page is useful official guidance for that facet (GOV.UK, legislation, council).
A person should be able to act or understand the rule from that page.
Shared words (e.g. "public") alone are NOT relevance.
A page about protest marches does not prove a place/posting/walls facet.
Prefer marking one strong official page per facet relevant=true when it clearly fits.
Only mark all false when every candidate is off-topic.`;

export async function judgeAdmitCandidates(
  question: string,
  facets: SignpostFacet[],
  candidates: AdmitCandidate[],
): Promise<AdmitJudgment[]> {
  if (!candidates.length) return [];

  const filtered = candidates.filter((c) => {
    const facet = facets.find((f) => f.id === c.facetId);
    if (!facet) return false;
    return !isSharedWordCollisionOnly(facet, c);
  });

  if (!filtered.length) return [];

  // Cap per facet so the judge JSON stays small and valid.
  const perFacet = new Map<string, number>();
  const capped = filtered.filter((c) => {
    const n = perFacet.get(c.facetId) || 0;
    if (n >= 4) return false;
    perFacet.set(c.facetId, n + 1);
    return true;
  });

  const payload = {
    question: question.slice(0, 2000),
    facets: facets.map((f) => ({ id: f.id, need: f.need })),
    candidates: capped.map((c) => ({
      facetId: c.facetId,
      urlOrId: c.urlOrId,
      title: c.title.slice(0, 120),
      excerpt: c.excerpt.slice(0, 420),
      date: c.date ?? null,
    })),
  };

  try {
    const raw = await chat(
      [
        { role: "system", content: ADMIT_SYSTEM },
        {
          role: "user",
          content:
            JSON.stringify(payload) +
            "\nUse each candidate's exact facetId and urlOrId strings in your judgments.",
        },
      ],
      {
        jsonMode: true,
        temperature: 0.1,
        maxTokens: 1200,
        model: smallModel(),
        purpose: "pack_classify",
        caller: "signpost-loop.admit",
        timeoutMs: 22_000,
      },
    );
    try {
      const parsed = AdmitJudgmentBatchSchema.safeParse(parseJsonFromLlm(raw));
      if (parsed.success) return parsed.data.judgments;
      console.warn("[signpost-loop.admit] schema fail:", parsed.error.message);
    } catch (parseErr) {
      console.warn(
        "[signpost-loop.admit] json fail:",
        parseErr instanceof Error ? parseErr.message : parseErr,
      );
    }
    const salvaged = salvageAdmitJudgments(raw);
    if (salvaged.length) {
      const parsed = AdmitJudgmentBatchSchema.safeParse({ judgments: salvaged });
      if (parsed.success) return parsed.data.judgments;
    }
    return [];
  } catch (err) {
    console.warn(
      "[signpost-loop.admit] failed:",
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}
