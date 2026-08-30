import type { AnswerPackage } from "@/lib/coherence/answerPackage";

export type OverviewCritique = {
  ok: boolean;
  score: number;
  errors: string[];
  critique: string;
  retryAgent: "overview" | null;
};

const SUCCESS_PREDICT =
  /\b(you will win|likely to (win|succeed)|guaranteed|definitely entitled|strong claim you)\b/i;

const PATHWAY_BOILERPLATE =
  /\b(start with the primary linked open source|keep evidence: contracts, receipts|from compiled wiki pathway)\b/i;

/**
 * Master Critic for the practical Overview recommendation.
 * Checks the answer actually addresses the client's story — not thin pathway packs.
 */
export function critiqueOverviewRecommendation(opts: {
  latestText: string;
  clientQuestion?: string;
  understanding?: string;
  answerPackage: AnswerPackage | null | undefined;
}): OverviewCritique {
  const errors: string[] = [];
  const pack = opts.answerPackage;
  const overview = String(pack?.answerOverview || "").trim();
  const story = [
    opts.latestText,
    opts.clientQuestion,
    opts.understanding,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (!pack) {
    errors.push("overview: missing answer package");
  } else if (overview.length < 160) {
    errors.push("overview: recommendation too short to be practical");
  }

  if (overview && SUCCESS_PREDICT.test(overview)) {
    errors.push("overview: predicts legal success / outcome");
  }

  if (overview && PATHWAY_BOILERPLATE.test(overview)) {
    errors.push("overview: thin pathway boilerplate instead of curated recommendation");
  }

  if (pack && (pack.wikiPages?.length || 0) < 2) {
    errors.push("overview: fewer than 2 wiki pages grounding the answer");
  }

  if (pack && (pack.recommendations?.length || 0) < 2) {
    errors.push("overview: fewer than 2 concrete recommendations");
  }

  if (pack && (pack.options?.length || 0) < 2) {
    errors.push("overview: fewer than 2 realistic options");
  }

  if (pack && (pack.followUps?.length || 0) < 3) {
    errors.push("overview: missing conversational follow-up actions");
  }

  // Client story themes the recommendation should touch when present
  const checks: { re: RegExp; label: string; need: RegExp }[] = [
    {
      re: /flatmate|housemate|lodger|share[d]?\s+accommodation|joint tenancy/i,
      label: "shared housing / joint tenancy",
      need: /joint|share|flatmate|housemate|lodger|tenancy|liable|contribution/i,
    },
    {
      re: /wifi|wi-?fi|broadband|internet/i,
      label: "broadband / WiFi",
      need: /wifi|wi-?fi|broadband|internet|password|provider|account/i,
    },
    {
      re: /camera|cctv|ring/i,
      label: "cameras / CCTV",
      need: /camera|cctv|record|ico|audio|surveillance/i,
    },
    {
      re: /threat|harass|lash/i,
      label: "threats / harassment",
      need: /threat|harass|police|safety|alarm|distress/i,
    },
    {
      re: /letter before|lba|money claim|unpaid/i,
      label: "letter before action / claim",
      need: /letter before|lba|claim|deadline|owed|due|contribution|debt/i,
    },
    {
      re: /\bpcns?\b|penalty charge|parking ticket|london tribunal/i,
      label: "PCN / parking appeal",
      need: /pcn|penalty charge|parking|appeal|tribunal|adjudicat|permit|contravention/i,
    },
    {
      re: /\b(threw|broke|broken|damaged|destroyed).{0,80}(switch|console|toy|gift|belongings)|sue.{0,40}(ex|mum|replacement)|can'?t afford a new/i,
      label: "damaged belongings / small claims",
      need: /small claim|letter before|money claim|county court|compensation|damag|replace|citizens advice|sue|claim/i,
    },
  ];

  const missingThemes: string[] = [];
  for (const c of checks) {
    if (c.re.test(story) && overview && !c.need.test(overview)) {
      missingThemes.push(c.label);
    }
  }
  // Fail only if several raised themes are ignored (avoid over-strict single misses)
  const hardThemes = missingThemes.filter(
    (t) => t === "PCN / parking appeal" || t === "damaged belongings / small claims",
  );
  if (missingThemes.length >= 2 || hardThemes.length) {
    errors.push(
      `overview: does not address client themes: ${missingThemes.slice(0, 4).join(", ")}`,
    );
  }

  if (
    /\bpcns?\b|penalty charge|parking ticket/i.test(story) &&
    /employment law|rights at work|working time|grievance procedure/i.test(overview) &&
    !/\bpcn|parking ticket|penalty charge|london tribunal/i.test(overview)
  ) {
    errors.push("overview: employment guidance for a PCN / parking appeal story");
  }

  if (
    /\b(threw|broke|broken|damaged).{0,80}(switch|console|toy|gift)|sue.{0,40}(ex|mum|replacement)/i.test(
      story,
    ) &&
    /child arrangements|custody|types of court orders in family|contact order/i.test(overview) &&
    !/small claim|letter before|money claim|county court|compensation|damag/i.test(overview)
  ) {
    errors.push("overview: family custody guidance for a belongings / small-claims story");
  }

  if (overview && !/legal\s*shaman\.?com/i.test(overview)) {
    errors.push("overview: missing LegalShaman.com recommendation note");
  }

  const origin = (pack as { origin?: string } | null | undefined)?.origin;
  if (
    pack?.matchedTopicId &&
    pack.matchedTopicId !== "vault-synthesized" &&
    origin !== "retrieve-llm" &&
    origin !== "retrieve-deterministic" &&
    overview.length < 400
  ) {
    errors.push("overview: still on thin curated pack instead of vault recommendation");
  }

  const ok = errors.length === 0;
  return {
    ok,
    score: ok ? 1 : Math.max(0, 1 - errors.length * 0.2),
    errors,
    critique: errors.join("; ") || "overview ok",
    retryAgent: ok ? null : "overview",
  };
}
