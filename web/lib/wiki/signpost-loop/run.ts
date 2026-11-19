import "server-only";

import {
  applyAdmitJudgments,
  candidatesForFacet,
  heuristicAdmitJudgments,
  judgeAdmitCandidates,
} from "./admit";
import type { AdmitCandidate, SignpostFacet } from "./types";

function admitWithFallback(
  question: string,
  facets: SignpostFacet[],
  candidates: AdmitCandidate[],
): Promise<ReturnType<typeof applyAdmitJudgments>> {
  return (async () => {
    const judgments = await judgeAdmitCandidates(question, facets, candidates);
    let admitted = applyAdmitJudgments(candidates, judgments);
    if (!admitted.length && candidates.length) {
      console.warn(
        `[signpost-loop] admit LLM kept 0 — heuristic fallback on ${candidates.length} candidates`,
      );
      admitted = applyAdmitJudgments(
        candidates,
        heuristicAdmitJudgments(facets, candidates),
      );
    }
    return admitted;
  })();
}
import { classifySignpostQuestion } from "./classify";
import {
  searchExaCandidatesForFacets,
  searchWikiCandidatesForFacets,
  volatileRescueCandidates,
} from "./retrieve";
import { writeSignpostAnswer } from "./write";
import type { AdmittedEvidence, SignpostLoopResult } from "./types";

/** Hard wall-clock budget so Ask the Shaman research cannot hang for minutes. */
const LOOP_BUDGET_MS = Number(process.env.SIGNPOST_LOOP_BUDGET_MS || 55_000);
const MAX_FACETS = 3;

function mergeAdmitted(
  existing: AdmittedEvidence[],
  next: AdmittedEvidence[],
): AdmittedEvidence[] {
  const urls = new Set(existing.map((a) => a.url));
  const out = [...existing];
  for (const row of next) {
    if (urls.has(row.url)) continue;
    out.push(row);
    urls.add(row.url);
  }
  return out;
}

function remaining(deadline: number): number {
  return deadline - Date.now();
}

function haveTime(deadline: number, needMs: number): boolean {
  return remaining(deadline) > needMs;
}

export async function runMeasuredSignpostLoop(
  question: string,
): Promise<SignpostLoopResult> {
  const t0 = Date.now();
  const deadline = t0 + (Number.isFinite(LOOP_BUDGET_MS) ? LOOP_BUDGET_MS : 55_000);
  const logStep = (label: string) => {
    console.info(
      `[signpost-loop] ${label} +${Date.now() - t0}ms remaining=${Math.max(0, remaining(deadline))}ms`,
    );
  };

  logStep("classify:start");
  const classification = await classifySignpostQuestion(question);
  // Cap facets so admit/Exa cannot explode runtime.
  classification.facets = classification.facets.slice(0, MAX_FACETS);
  logStep(`classify:done facets=${classification.facets.length}`);

  // 2–3: Wiki search per facet, then admit.
  const wikiCandidates = searchWikiCandidatesForFacets(classification.facets);
  let admitted: AdmittedEvidence[] = [];
  if (wikiCandidates.length && haveTime(deadline, 8_000)) {
    logStep(`admit-wiki:start candidates=${wikiCandidates.length}`);
    admitted = await admitWithFallback(
      question,
      classification.facets,
      wikiCandidates,
    );
    logStep(`admit-wiki:done admitted=${admitted.length}`);
  } else {
    logStep("admit-wiki:skip");
  }

  // 4: Exa only for facets with zero admitted wiki pages.
  const needingExa = new Set(
    classification.facets
      .filter((f) => candidatesForFacet(f.id, admitted).length === 0)
      .map((f) => f.id),
  );

  if (needingExa.size > 0 && haveTime(deadline, 12_000)) {
    logStep(`exa:start facets=${needingExa.size}`);
    const exaCandidates = await searchExaCandidatesForFacets(
      classification.facets,
      needingExa,
    );
    if (exaCandidates.length && haveTime(deadline, 8_000)) {
      const exaAdmitted = await admitWithFallback(
        question,
        classification.facets.filter((f) => needingExa.has(f.id)),
        exaCandidates,
      );
      admitted = mergeAdmitted(admitted, exaAdmitted);
    } else if (exaCandidates.length) {
      // Budget tight — still keep official Exa hits via heuristic.
      admitted = mergeAdmitted(
        admitted,
        applyAdmitJudgments(
          exaCandidates,
          heuristicAdmitJudgments(
            classification.facets.filter((f) => needingExa.has(f.id)),
            exaCandidates,
          ),
        ),
      );
    }
    logStep(`exa:done admitted=${admitted.length}`);
  } else if (needingExa.size > 0) {
    logStep("exa:skip budget");
  }

  // 5: Volatile rescue — only when a volatile facet still has *zero* admits.
  // (Do not re-fetch just because a wiki hit isn't on .gov.uk — that was burning 20–40s.)
  const missingVolatile = classification.facets
    .filter((f) => f.volatile && candidatesForFacet(f.id, admitted).length === 0)
    .map((f) => f.id);

  if (missingVolatile.length > 0 && haveTime(deadline, 14_000)) {
    logStep(`rescue:start facets=${missingVolatile.length}`);
    const rescueCandidates = await volatileRescueCandidates(
      classification,
      missingVolatile,
    );
    if (rescueCandidates.length && haveTime(deadline, 8_000)) {
      const rescueAdmitted = await admitWithFallback(
        question,
        classification.facets.filter((f) => missingVolatile.includes(f.id)),
        rescueCandidates,
      );
      admitted = mergeAdmitted(admitted, rescueAdmitted);
    } else if (rescueCandidates.length) {
      admitted = mergeAdmitted(
        admitted,
        applyAdmitJudgments(
          rescueCandidates,
          heuristicAdmitJudgments(
            classification.facets.filter((f) => missingVolatile.includes(f.id)),
            rescueCandidates,
          ),
        ),
      );
    }
    logStep(`rescue:done admitted=${admitted.length}`);
  } else if (missingVolatile.length > 0) {
    logStep("rescue:skip budget");
  }

  // 6: Write from admitted rows only.
  if (!admitted.length) {
    logStep("insufficient:no-admitted");
    return {
      classification,
      admitted,
      answer: null,
      mode: "insufficient",
      message:
        "No official page was admitted for this question. Try naming the council or checking GOV.UK.",
    };
  }

  if (!haveTime(deadline, 6_000)) {
    logStep("write:skip budget — returning excerpts");
    return {
      classification,
      admitted,
      answer: formatExcerptAnswer(admitted),
      mode: "synthesis",
    };
  }

  logStep("write:start");
  const answer = await writeSignpostAnswer({
    question,
    classification,
    admitted,
  });
  logStep(answer ? "write:done" : "write:failed");

  if (answer) {
    return {
      classification,
      admitted,
      answer,
      mode: "synthesis",
    };
  }

  // Write failed — still return admitted excerpts so the UI is not empty / rigid.
  return {
    classification,
    admitted,
    answer: formatExcerptAnswer(admitted),
    mode: "synthesis",
  };
}

function formatExcerptAnswer(admitted: AdmittedEvidence[]): string {
  const body = admitted
    .slice(0, 4)
    .map((a) => {
      const title = (a.title || "Source").replace(/\s+/g, " ").trim().slice(0, 48);
      const excerpt =
        a.excerpt.slice(0, 280) + (a.excerpt.length > 280 ? "…" : "");
      return `${title}: ${excerpt}\n[${title || "Source"}](${a.url})`;
    })
    .join("\n\n");
  return (
    body +
    "\n\nThis is general information from official sources, not legal advice."
  );
}

export function admittedUrlsKey(admitted: AdmittedEvidence[]): string {
  return [...new Set(admitted.map((a) => a.url))]
    .map((u) => u.toLowerCase())
    .sort()
    .join("|");
}
