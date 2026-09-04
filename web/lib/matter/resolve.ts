import { resolveTaxonomy } from "@/lib/legal/taxonomy-resolver";
import type { TaxonomyResolution } from "@/lib/legal/taxonomy-resolver";
import { isFamilyBelongingsPropertyClaim } from "@/lib/legal/query-signals";
import {
  storyLooksWorkplaceLeaveOrStaffRules,
  storyLooksWorkplaceNeurodiversityAdjustments,
} from "@/lib/coherence/hypothesisProbe";
import { normaliseLayText } from "@/lib/coherence/normaliseLay";

import { extractStoryKeyphrases } from "./conceptRetrievalPlan";
import {
  extractRelationshipModel,
  preferDisputeIssues,
} from "./relationships";
import { storyLooksAmbiguousSeizedDevice, storyLooksEmployerSeizedKit } from "./graphAdmissibility";
import { buildRetrievalPlan, syncEventIssueLinks } from "./retrieval-plan";
import {
  GLOBAL_EXCLUSION_LABELS,
  ISSUE_TITLE_EXCLUSIONS,
  retrievalScopeForSlugs,
} from "./scopes";
import type {
  AmbiguityMateriality,
  MatterAmbiguity,
  MatterDiagnostics,
  MatterFrame,
  MatterIssue,
  MatterResolutionStatus,
  MatterResolveInput,
  MatterResolveResult,
} from "./types";

function matterId(): string {
  return `matter-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function scoreToConfidence(score: number): number {
  return Math.min(0.99, Math.max(0.05, score / 55));
}

function issueFromCandidate(c: { slug: string; score: number; sources?: string[] }): MatterIssue {
  return {
    slug: c.slug,
    confidence: scoreToConfidence(c.score),
    reason: (c.sources || []).slice(0, 4).join("; ") || "taxonomy-score",
  };
}

function parseJurisdiction(hint?: string): MatterFrame["jurisdiction"] {
  const h = (hint || "").toLowerCase();
  if (/scotland|scottish/.test(h)) return { code: "scotland", confidence: 0.9 };
  if (/northern ireland|ni\b/.test(h)) return { code: "northern_ireland", confidence: 0.9 };
  if (/england|wales|uk\b/.test(h) || !h) {
    return { code: "england_wales", confidence: hint ? 0.85 : 0.6 };
  }
  return { code: "england_wales", confidence: 0.5 };
}

function looksProtectedCharacteristicClaim(story: string): boolean {
  return (
    /\b(discriminat|harass(?:ment|ed)?|bullied|bullying|protected characteristic|reasonable adjustments?|pregnancy discriminat|racist|homophob|sexist|disability discriminat)\b/i.test(
      story,
    ) || storyLooksWorkplaceNeurodiversityAdjustments(story)
  );
}

function buildExclusions(
  primarySlugs: string[],
  taxonomy: TaxonomyResolution | null,
  story = "",
  keepSlugs: string[] = [],
): string[] {
  const out = new Set<string>();
  for (const slug of primarySlugs) {
    const pattern = ISSUE_TITLE_EXCLUSIONS[slug];
    if (!pattern) continue;
    if (/\bemployment tribunal|rights at work|working time\b/i.test(pattern.source)) {
      if (!keepSlugs.includes("employment") && !primarySlugs.includes("employment")) {
        out.add("employment");
      }
    }
    if (/used car|car repair/i.test(pattern.source)) out.add("used_vehicle");
    if (/travel agent/i.test(pattern.source)) out.add("travel_agent");
    if (/consumer contracts|distance/i.test(pattern.source)) out.add("distance_contracts");
    if (/insurance/i.test(pattern.source)) out.add("motor_insurance");
    if (/parking ticket|pcn/i.test(pattern.source)) out.add("parking_pcn");
  }
  if (primarySlugs.includes("parking_pcn")) {
    out.add("employment");
    out.add("used_vehicle");
  }
  if (primarySlugs.includes("consumer_vehicle_repair") || primarySlugs.includes("consumer")) {
    out.add("employment");
    out.add("parking_pcn");
  }
  if (primarySlugs.includes("consumer_services")) out.add("employment");
  if (primarySlugs.includes("conveyancing")) {
    out.add("used_vehicle");
    out.add("travel_agent");
    out.add("distance_contracts");
  }
  if (primarySlugs.includes("housing") && !primarySlugs.includes("consumer_vehicle_repair")) {
    out.add("used_vehicle");
  }
  if (taxonomy?.confidence === "high" && primarySlugs.includes("employment")) {
    for (const label of GLOBAL_EXCLUSION_LABELS) {
      if (label !== "employment") out.delete(label);
    }
  }
  if (!looksProtectedCharacteristicClaim(story)) {
    out.add("discrimination_equality");
  }
  for (const slug of [...primarySlugs, ...keepSlugs]) out.delete(slug);
  return [...out];
}

function buildConcepts(
  primarySlugs: string[],
  taxonomy: TaxonomyResolution | null,
  story = "",
  agentConcepts: string[] = [],
): string[] {
  const concepts = new Set<string>();
  for (const slug of primarySlugs) {
    concepts.add(slug.replace(/_/g, " "));
  }
  // Matter-resolution LLM concepts first (LexKeyPlan IR)
  for (const term of agentConcepts) {
    const t = term.trim().toLowerCase();
    if (t.length >= 3) concepts.add(t);
  }
  for (const term of taxonomy?.searchBoostTerms?.slice(0, 8) || []) {
    if (term.length >= 4) concepts.add(term.toLowerCase());
  }
  // LexKeyPlan: story keyphrases compound into the frame (wiki navigation IR)
  for (const phrase of extractStoryKeyphrases(story, 8)) {
    concepts.add(phrase);
  }
  return [...concepts].slice(0, 20);
}

function buildObjectives(input: MatterResolveInput, primarySlugs: string[]): string[] {
  const blob = [input.clientQuestion, input.understanding, input.submission].join(" ").toLowerCase();
  const objectives: string[] = [];
  if (/\bappeal\b/.test(blob)) objectives.push("appeal");
  if (/\brefund|money back|compensation\b/.test(blob)) objectives.push("compensation");
  if (/\brepair|fix\b/.test(blob)) objectives.push("repair");
  if (/\bevict|section 21|leave home\b/.test(blob)) objectives.push("stay_in_home");
  if (/\bdeposit\b/.test(blob)) objectives.push("deposit_return");
  if (/\bgo after|sue|claim|lawsuit|liability\b/.test(blob)) objectives.push("civil_claim");
  if (/\bconveyanc|buy|purchase|flat|house\b/.test(blob) && primarySlugs.includes("conveyancing")) {
    objectives.push("property_purchase");
  }
  if (!objectives.length && input.brief?.goal) objectives.push(input.brief.goal.slice(0, 80));
  return objectives.slice(0, 6);
}

function withMateriality(
  a: Omit<MatterAmbiguity, "materiality"> & { materiality?: AmbiguityMateriality },
): MatterAmbiguity {
  const materiality = a.materiality || "medium";
  return {
    ...a,
    materiality,
    blocking:
      a.blocking ??
      (materiality === "high" && Boolean(a.affectsIssues?.length || a.affectsRetrieval)),
  };
}

function buildAmbiguities(
  taxonomy: TaxonomyResolution | null,
  input: MatterResolveInput,
  independentIssueCount = 0,
): MatterAmbiguity[] {
  const out: MatterAmbiguity[] = [];
  const candidates = taxonomy?.candidates || [];
  const top = candidates[0];
  const second = candidates[1];
  const closeCall = Boolean(
    second && top && second.score / top.score >= 0.78 && independentIssueCount < 2,
  );

  if (closeCall && top && second) {
    out.push(
      withMateriality({
        question: `Is this mainly about ${top.slug.replace(/_/g, " ")} or ${second.slug.replace(/_/g, " ")}?`,
        whyItMatters: "Retrieval scope and help routing differ between these issues.",
        materiality: "high",
        affectsIssues: [top.slug, second.slug],
        affectsRetrieval: true,
      }),
    );
  }
  if (taxonomy?.confidence === "low") {
    out.push(
      withMateriality({
        question: taxonomy.clarificationQuestion || "Which part of this situation is the live legal problem?",
        whyItMatters: "Issue confidence is low — scoped retrieval may be wrong without clarification.",
        materiality: "high",
        affectsRetrieval: true,
      }),
    );
  }
  for (const u of input.brief?.openUncertainties?.slice(0, 2) || []) {
    if (!u.suggestedAsk) continue;
    out.push(
      withMateriality({
        question: u.suggestedAsk,
        whyItMatters: u.whyItMatters || "Brief agent flagged uncertainty.",
        materiality: "medium",
      }),
    );
  }
  const story = [input.submission, input.clientQuestion, input.brief?.whatHappened]
    .filter(Boolean)
    .join("\n");
  if (storyLooksAmbiguousSeizedDevice(story)) {
    out.push(
      withMateriality({
        question: "Are you the person who was arrested, or the employer whose equipment the police took?",
        whyItMatters:
          "Criminal-defence pages and SRA cards assume the asker is the suspect. Return-of-property pages assume they own the kit.",
        materiality: "high",
        affectsRetrieval: true,
        blocking: true,
      }),
    );
  }
  return out.slice(0, 4);
}

function isVagueSubmission(submission: string): boolean {
  const blob = submission.toLowerCase();
  if (/\b(pcn|landlord|tenant|flat|house|van|garage|appeal|section 21|deposit|estate agent)\b/.test(blob)) {
    return false;
  }
  return (
    /\b(not sure|something happened|something else|don't know|do not know|unclear)\b/.test(blob) &&
    (/\bwork\b|deadline|letter|money\b/.test(blob) || blob.length < 220)
  );
}

function inferVagueIssues(submission: string): MatterIssue[] {
  const blob = submission.toLowerCase();
  const issues: MatterIssue[] = [];
  if (/\bwork\b|boss|employer|colleague/.test(blob)) {
    issues.push({ slug: "employment", confidence: 0.35, reason: "vague-work-backdrop" });
  }
  if (/\bmoney|deadline|letter|debt|owe|pay\b/.test(blob)) {
    issues.push({ slug: "debt", confidence: 0.32, reason: "vague-money-deadline" });
  }
  if (/\bconsumer|refund|trader|buy\b/.test(blob) || issues.length === 0) {
    issues.push({ slug: "consumer", confidence: 0.28, reason: "vague-consumer-fallback" });
  }
  return issues.slice(0, 3);
}

function vagueAmbiguities(submission: string): MatterAmbiguity[] {
  const blob = submission.toLowerCase();
  const out: MatterAmbiguity[] = [];
  if (/\bwork\b/.test(blob) && /\bmoney|deadline|letter\b/.test(blob)) {
    out.push(
      withMateriality({
        question: "Is the letter from your employer, a creditor, or someone else?",
        whyItMatters: "Employment, debt, and consumer routes differ completely.",
        materiality: "high",
        affectsIssues: ["employment", "debt", "consumer"],
        affectsRetrieval: true,
      }),
    );
  }
  if (/\bnot sure|something else\b/.test(blob)) {
    out.push(
      withMateriality({
        question: "What does the letter say it is about, and who sent it?",
        whyItMatters: "Issue routing needs the legal relationship behind the deadline.",
        materiality: "high",
        affectsRetrieval: true,
      }),
    );
  }
  return out;
}

function mergeTaxonomy(input: MatterResolveInput): TaxonomyResolution | null {
  const story = normaliseLayText(input.submission.trim());
  const resolved = resolveTaxonomy({
    story,
    question: normaliseLayText(input.clientQuestion || input.brief?.clientQuestion || ""),
    understanding: normaliseLayText(input.understanding || input.brief?.understanding || ""),
  });
  if (!resolved) return null;

  const agentBoosts = [
    ...(input.agentConcepts || []),
    ...(input.taxonomy?.searchBoostTerms || []),
  ]
    .map((t) => String(t).trim().toLowerCase())
    .filter((t) => t.length >= 3);

  let next: TaxonomyResolution = resolved;
  if (agentBoosts.length) {
    next = {
      ...resolved,
      searchBoostTerms: [
        ...new Set([...agentBoosts, ...resolved.searchBoostTerms]),
      ].slice(0, 12),
    };
  }

  const classifySlug = input.classify?.taxonomySlug || input.taxonomy?.taxonomySlug;
  if (classifySlug && classifySlug !== next.taxonomySlug) {
    const boosted = next.candidates.find((c) => c.slug === classifySlug);
    if (boosted) {
      return {
        ...next,
        taxonomySlug: classifySlug,
        confidence: input.taxonomy?.confidence === "high" ? "high" : next.confidence,
        reason: `classify-stamp:${classifySlug}; ${next.reason}`,
        candidates: [
          { slug: classifySlug, score: Math.max(boosted.score, 50), sources: ["classify-stamp"] },
          ...next.candidates.filter((c) => c.slug !== classifySlug),
        ],
      };
    }
  }
  return next;
}

function deriveResolutionStatus(opts: {
  primary: MatterIssue[];
  ambiguities: MatterAmbiguity[];
  jurisdiction?: MatterFrame["jurisdiction"];
  relationshipUncertain: boolean;
}): MatterResolutionStatus {
  const { primary, ambiguities, jurisdiction, relationshipUncertain } = opts;
  if (relationshipUncertain) return "relationship_uncertain";
  if (!primary.length) return "insufficient_facts";
  if (jurisdiction?.code === "scotland" || jurisdiction?.code === "northern_ireland") {
    if ((jurisdiction.confidence || 0) < 0.7) return "jurisdiction_uncertain";
  }
  if (
    (primary[0]?.confidence || 0) < 0.55 ||
    ambiguities.some((a) => a.blocking && a.affectsRetrieval)
  ) {
    return "partially_resolved";
  }
  return "resolved";
}

export function resolveMatterFrame(input: MatterResolveInput): MatterResolveResult {
  const taxonomy = mergeTaxonomy(input);
  const candidates = taxonomy?.candidates || [];
  const relationshipModel = extractRelationshipModel(input);

  let primaryIssues: MatterIssue[] = [];
  let secondaryIssues: MatterIssue[] = [];

  if (candidates.length) {
    primaryIssues.push(issueFromCandidate(candidates[0]!));
    for (const c of candidates.slice(1, 5)) {
      if (c.score >= 6) secondaryIssues.push(issueFromCandidate(c));
    }
  } else if (taxonomy?.taxonomySlug) {
    primaryIssues.push({
      slug: taxonomy.taxonomySlug,
      confidence: taxonomy.confidence === "high" ? 0.9 : taxonomy.confidence === "medium" ? 0.75 : 0.45,
      reason: taxonomy.reason,
    });
  } else if (isVagueSubmission(input.submission)) {
    const inferred = inferVagueIssues(input.submission);
    if (inferred[0]) primaryIssues.push(inferred[0]);
    for (const issue of inferred.slice(1)) secondaryIssues.push(issue);
  }

  const preferred = preferDisputeIssues(primaryIssues, secondaryIssues, relationshipModel);
  primaryIssues = preferred.primary;
  secondaryIssues = preferred.secondary;

  // Ex broke child's gift / sue for replacement → small claims primary, family secondary
  const storyBlob = [input.submission, input.clientQuestion, input.understanding]
    .filter(Boolean)
    .join("\n");
  if (isFamilyBelongingsPropertyClaim(storyBlob)) {
    const smallClaims: MatterIssue = {
      slug: "consumer_small_claims",
      confidence: Math.max(0.78, primaryIssues[0]?.confidence ?? 0.78),
      reason: "family backdrop + damaged belongings / civil recovery",
    };
    const familyKept = [...primaryIssues, ...secondaryIssues].filter((i) => i.slug === "family");
    secondaryIssues = [
      ...familyKept,
      ...[...primaryIssues, ...secondaryIssues].filter(
        (i) => i.slug !== "family" && i.slug !== "consumer_small_claims",
      ),
    ].slice(0, 4);
    primaryIssues = [smallClaims];
  }

  // Contact / school-language bleed: workplace leave or staff rules must not pin primary family.
  if (storyLooksWorkplaceLeaveOrStaffRules(storyBlob)) {
    const employmentIssue: MatterIssue = {
      slug: "employment",
      confidence: Math.max(0.72, primaryIssues[0]?.confidence ?? 0.72),
      reason: "workplace leave / staff rules",
    };
    const primaryIsFamily =
      primaryIssues[0]?.slug === "family" ||
      primaryIssues[0]?.slug?.startsWith("family") ||
      Boolean(primaryIssues[0]?.slug?.includes("child"));

    if (primaryIsFamily || !primaryIssues.length) {
      const familyKept = [...primaryIssues, ...secondaryIssues].filter(
        (i) => i.slug === "family" || i.slug.includes("child"),
      );
      secondaryIssues = [
        ...familyKept.map((i) => ({ ...i, confidence: Math.min(i.confidence, 0.4) })),
        ...[...primaryIssues, ...secondaryIssues].filter(
          (i) => i.slug !== "family" && i.slug !== "employment" && !i.slug.includes("child"),
        ),
      ].slice(0, 4);
      primaryIssues = [employmentIssue];
      if (
        storyLooksWorkplaceNeurodiversityAdjustments(storyBlob) &&
        !secondaryIssues.some((s) => s.slug === "discrimination_equality")
      ) {
        secondaryIssues.unshift({
          slug: "discrimination_equality",
          confidence: 0.55,
          reason: "workplace neurodiversity / adjustment cues",
        });
      }
    } else if (
      !primaryIssues.some((i) => i.slug === "employment" || i.slug.startsWith("employment")) &&
      !secondaryIssues.some((i) => i.slug === "employment")
    ) {
      secondaryIssues.unshift({
        slug: "employment",
        confidence: 0.62,
        reason: "workplace leave / staff-rules competitor",
      });
    }
  }

  if (
    primaryIssues[0]?.slug === "housing" &&
    relationshipModel.relationships.some((r) => r.type === "employment") &&
    !secondaryIssues.some((s) => s.slug === "employment")
  ) {
    secondaryIssues.unshift({
      slug: "employment",
      confidence: 0.45,
      reason: "dual-capacity:landlord also employer",
    });
  }

  const disputedSupports = new Set(
    relationshipModel.events.filter((e) => e.disputed).flatMap((e) => e.supportsIssues),
  );
  secondaryIssues = secondaryIssues.filter(
    (i) =>
      i.confidence >= 0.4 ||
      disputedSupports.has(i.slug) ||
      (i.slug === "employment" &&
        relationshipModel.relationships.some((r) => r.type === "employment")),
  );

  const primarySlugs = primaryIssues.map((i) => i.slug);
  const secondarySlugs = secondaryIssues.map((i) => i.slug);
  const top = candidates[0];
  const second = candidates[1];
  const independentIssueCount = new Set(relationshipModel.disputeIssueHints.map((h) => h.slug)).size;
  const closeCall = Boolean(
    second && top && second.score / top.score >= 0.78 && independentIssueCount < 2,
  );

  let ambiguities = [
    ...relationshipModel.ambiguities,
    ...buildAmbiguities(taxonomy, input, independentIssueCount),
  ];
  if (!ambiguities.length && isVagueSubmission(input.submission)) {
    ambiguities = vagueAmbiguities(input.submission);
  }

  if (!primaryIssues.length) {
    ambiguities = [
      withMateriality({
        question: "What happened between you and the other person?",
        whyItMatters: "The submission does not establish a legally relevant relationship or event.",
        materiality: "high",
        affectsRetrieval: true,
        reason: "insufficient_facts:empty primaryIssues",
      }),
      ...ambiguities,
    ].slice(0, 5);
  }

  const seenQ = new Set<string>();
  ambiguities = ambiguities.filter((a) => {
    const key = a.question.toLowerCase();
    if (seenQ.has(key)) return false;
    seenQ.add(key);
    return true;
  });

  let overallConfidence = primaryIssues[0]?.confidence ?? 0.18;
  if (!primaryIssues.length) overallConfidence = 0.18;
  else if (isVagueSubmission(input.submission) && !taxonomy?.taxonomySlug) {
    overallConfidence = Math.min(overallConfidence, 0.45);
  }

  const jurisdiction = parseJurisdiction(
    input.jurisdictionHint || input.submission || input.brief?.whatHappened,
  );
  const relationshipUncertain = relationshipModel.events.some((e) => e.type === "collision");

  const resolutionStatus = deriveResolutionStatus({
    primary: primaryIssues,
    ambiguities,
    jurisdiction,
    relationshipUncertain,
  });

  if (resolutionStatus === "insufficient_facts") overallConfidence = Math.min(overallConfidence, 0.25);
  if (resolutionStatus === "relationship_uncertain") overallConfidence = Math.min(overallConfidence, 0.5);
  if (ambiguities.some((a) => a.blocking)) {
    overallConfidence = Math.min(overallConfidence, 0.62);
  }

  let frame: MatterFrame = {
    matterId: matterId(),
    jurisdiction,
    primaryIssues,
    secondaryIssues,
    parties: relationshipModel.parties,
    capacities: relationshipModel.capacities,
    relationships: relationshipModel.relationships,
    events: relationshipModel.events,
    proceduralPosture: /\bappeal|tribunal|court|claim|sue\b/i.test(input.submission)
      ? "pre_action"
      : undefined,
    objectives: buildObjectives(input, primarySlugs),
    concepts: buildConcepts(
      primarySlugs,
      taxonomy,
      [input.submission, input.clientQuestion, input.understanding].filter(Boolean).join("\n"),
      [
        ...(input.agentConcepts || []),
        ...(input.taxonomy?.searchBoostTerms || []),
      ],
    ),
    exclusions: buildExclusions(primarySlugs, taxonomy, storyBlob, secondarySlugs),
    ambiguities,
    overallConfidence,
    resolutionStatus,
    provenance: {
      briefAgent: input.brief
        ? {
            understanding: input.brief.understanding,
            clientQuestion: input.brief.clientQuestion,
            goal: input.brief.goal,
          }
        : undefined,
      taxonomyAgent: taxonomy
        ? {
            slug: taxonomy.taxonomySlug,
            confidence: taxonomy.confidence,
            reason: taxonomy.reason,
            candidates: taxonomy.candidates.slice(0, 5),
          }
        : undefined,
      classifyAgent: input.classify
        ? {
            matterType: input.classify.matterType,
            topicId: input.classify.topicId,
            taxonomySlug: input.classify.taxonomySlug,
          }
        : undefined,
      relationshipModel: {
        disputeEventIds: relationshipModel.disputeEventIds,
        relationshipTypes: relationshipModel.relationships.map((r) => r.type),
        capacities: relationshipModel.capacities.map((c) => `${c.partyId}:${c.capacity}`),
      },
    },
    retrievalScope: retrievalScopeForSlugs([...primarySlugs, ...secondarySlugs.slice(0, 2)]),
  };

  if (
    storyLooksEmployerSeizedKit(storyBlob) &&
    !frame.capacities.some((c) => c.partyId === "user" && c.capacity === "employer")
  ) {
    frame.capacities = [
      ...frame.capacities,
      { partyId: "user", capacity: "employer", confidence: 0.82 },
    ];
  }

  frame = syncEventIssueLinks(frame);
  const { traces } = buildRetrievalPlan(frame);
  frame.provenance.retrievalTraces = traces.slice(0, 12);

  const diagnostics: MatterDiagnostics = {
    resolvedAt: new Date().toISOString(),
    taxonomyConfidence: taxonomy?.confidence ?? null,
    closeCall,
    candidateCount: candidates.length,
    disputeEventIds: relationshipModel.disputeEventIds,
    relationshipCount: relationshipModel.relationships.length,
  };

  return { frame, diagnostics };
}

export const MatterEngine = {
  resolve: resolveMatterFrame,
};
