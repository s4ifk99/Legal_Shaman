import "server-only";

import { prisma } from "@/lib/db/prisma";
import { parseQuery } from "@/lib/legal-search/query-understanding";
import { embedOne, embedConfigured } from "@/lib/llm/client";
import {
  ExtractedFiltersSchema,
  PRACTICE_AREA_SLUGS,
  DISCLAIMER,
  type AgentInput,
  type AgentResult,
  type AnyMatch,
  type ExtractedFilters,
  type LawyerMatch,
  type MatchLocation,
  type OrgMatch,
  type PracticeAreaSlug,
} from "@/lib/agent/types";
import type { MapMarker } from "@/lib/search/map-results";
import {
  extractPhoneFromSraSearchText,
  resolveSraDisplayName,
} from "@/lib/search/sra-display";
import type { ParsedQuery } from "@/lib/legal-search/types";
import { extractFilters } from "@/lib/agent/extractor";
import {
  generateClarifyingQuestion,
  isExtractionGrounded,
} from "@/lib/agent/clarifier";
import { explainMatches, type ExplainArg } from "@/lib/agent/explainer";
import { hybridLawyerSearch } from "@/lib/lawyers/search";
import { rankLawyers, diversifyMatcherRanked, type RankedCandidate } from "@/lib/lawyers/rank";
import { loadBehaviouralSignalsForEntities } from "@/lib/search-events/load-ranking-signals";
import { fetchTypesenseMatcherCandidates } from "@/lib/legal-search/matcher-recall";
import { mergeMatcherCandidates } from "@/lib/legal-search/merge-candidates";
import { enableSearchDebug, enableTypesenseUnified } from "@/lib/legal-search/config";
import {
  attachMatcherDebug,
  buildSearchResponseDebug,
  MATCHER_RERANKER_VERSION,
} from "@/lib/legal-search/search-diagnostics";
import { sanitizeAdviceText } from "@/lib/guardrails/validator";
import {
  resolveMatcherSearchOrigin,
  resolveRankedCandidateLocation,
} from "@/lib/legal-search/matcher-location";
import {
  applyVagueParsedQueryUx,
  detectVagueLegalQuery,
} from "@/lib/legal-search/vague-query-rescue";
import {
  boundsFromMarkers,
  buildMatcherMapMarkers,
  countMissingMatcherCoordinates,
} from "@/lib/search/map-results";

const TOP_K = 5;

function mergeExtractedWithTaxonomy(extracted: ExtractedFilters, parsed: ParsedQuery): ExtractedFilters {
  const slug = parsed.practiceAreaSlug;
  const fromTax =
    slug && (PRACTICE_AREA_SLUGS as readonly string[]).includes(slug) ? (slug as PracticeAreaSlug) : undefined;
  const practiceArea = extracted.practiceArea ?? fromTax ?? null;
  const taxonomyAssists = Boolean(parsed.queryConfidence && parsed.queryConfidence !== "low" && practiceArea);
  const confidence =
    extracted.confidence >= 0.55
      ? extracted.confidence
      : taxonomyAssists
        ? Math.max(extracted.confidence, 0.56)
        : extracted.confidence;
  return ExtractedFiltersSchema.parse({
    ...extracted,
    practiceArea,
    confidence,
    semanticQuery: (extracted.semanticQuery || parsed.semanticQuery || parsed.rawText).trim().slice(0, 400),
  });
}

/**
 * Orchestrator. Single entry point for both /api/search and /api/search/clarify.
 * Pipeline: extract -> (clarify | embed -> hybrid -> rank -> explain -> guard) -> log.
 */
export async function runAgent(
  input: AgentInput,
  opts?: { preParsed?: ParsedQuery },
): Promise<AgentResult> {
  const t0 = Date.now();
  let parsed = opts?.preParsed ?? (await parseQuery(input.query));
  const extracted = await extractFilters(input.query);
  const merged = mergeExtractedWithTaxonomy(extracted, parsed);

  const applied = input.appliedFilters;
  const vagueRescue = detectVagueLegalQuery(parsed, {
    cityFilter: applied?.city,
    languageFilter: applied?.language,
    practiceAreaFilter: applied?.practiceArea,
  });
  if (vagueRescue) parsed = applyVagueParsedQueryUx(parsed);

  const skipClarify =
    Boolean(applied?.practiceArea || applied?.city || applied?.language) || vagueRescue;

  if (!skipClarify && !isExtractionGrounded(merged, parsed)) {
    const question =
      parsed.queryConfidence === "low" && parsed.refinementQuestion?.trim()
        ? parsed.refinementQuestion.trim()
        : await generateClarifyingQuestion(input.query, merged);
    const latencyMs = Date.now() - t0;
    await logInteraction({
      sessionId: input.sessionId,
      query: input.query,
      extracted: merged,
      parsed,
      clarifyingAsked: true,
      resultIds: [],
      latencyMs,
    });
    let clarifyResult: AgentResult = { kind: "clarify", question, disclaimer: DISCLAIMER };
    if (enableSearchDebug()) {
      clarifyResult.searchDebug = buildSearchResponseDebug({
        channel: "matcher",
        query: input.query,
        parsedQuery: parsed,
        degradedModes: [],
        latencyMs,
        rerankerVersion: MATCHER_RERANKER_VERSION,
        results: [],
        extracted: merged,
        appliedFilters: applied,
        clarificationDecision: "asked",
      });
    }
    return clarifyResult;
  }

  const keywordText = (parsed.expandedSearchText || merged.semanticQuery || input.query).trim().slice(0, 400);

  let embedding: Float32Array | null = null;
  if (embedConfigured()) {
    try {
      embedding = await embedOne(keywordText);
    } catch (err) {
      console.warn("[agent.workflow] embed failed, continuing without semantic:", err);
    }
  }

  const pgCandidates = await hybridLawyerSearch({
    extracted: merged,
    applied,
    embedding,
    keyword: keywordText,
  });

  const tsCandidates = enableTypesenseUnified()
    ? await fetchTypesenseMatcherCandidates({
        keyword: keywordText,
        expandedQ: parsed.expandedSearchText || keywordText,
        practiceArea: merged.practiceArea,
        city: merged.city,
      })
    : [];

  const candidates = mergeMatcherCandidates(pgCandidates, tsCandidates);
  const degradedModes = tsCandidates.length ? ["typesense_matcher_recall"] : undefined;

  const behaviouralSignals = await loadBehaviouralSignalsForEntities(
    candidates.map((c) =>
      c.kind === "lawyer"
        ? { id: c.lawyer.id, source: "lawyer" }
        : { id: c.org.id, source: "sra" },
    ),
    { practiceArea: merged.practiceArea, city: merged.city },
  );
  const ranked = diversifyMatcherRanked(
    rankLawyers(candidates, merged, { behaviouralSignals }),
    input.query,
    TOP_K,
  );

  const explainArgs: ExplainArg[] = ranked.map((r) =>
    r.kind === "lawyer"
      ? { kind: "lawyer", lawyer: r.lawyer, extracted: merged }
      : { kind: "org", org: r.org, extracted: merged },
  );
  const explanationMap = explainArgs.length
    ? await explainMatches(explainArgs)
    : new Map<string, string>();

  const origin = await resolveMatcherSearchOrigin(merged);
  const matches: AnyMatch[] = [];
  const rankedForDebug = [...ranked];
  for (const r of ranked) {
    const explanationKey = r.kind === "lawyer" ? r.lawyer.id : r.org.id;
    const explanation = sanitizeAdviceText(
      explanationMap.get(explanationKey) ??
        (r.kind === "lawyer" ? "Listed in our directory." : "SRA-verified UK firm."),
    );
    const loc = await resolveRankedCandidateLocation(r, origin);
    if (loc.mapMarker) loc.mapMarker.explanation = explanation;
    matches.push(toMatch(r, explanation, loc));
  }

  let finalMatches = matches;
  if (enableSearchDebug()) {
    finalMatches = attachMatcherDebug(matches, rankedForDebug, parsed, merged);
  }

  const markers = buildMatcherMapMarkers(finalMatches);
  const missingCoordinateCount = countMissingMatcherCoordinates(finalMatches);
  const latencyMs = Date.now() - t0;

  await logInteraction({
    sessionId: input.sessionId,
    query: input.query,
    extracted: merged,
    parsed,
    clarifyingAsked: false,
    resultIds: finalMatches.map((m) => m.id),
    latencyMs,
    degradedModes,
    mapUsed: markers.length > 0,
  });

  let matchResult: AgentResult = {
    kind: "matches",
    results: finalMatches,
    markers,
    markerCount: markers.length,
    missingCoordinateCount,
    bounds: boundsFromMarkers(markers),
    disclaimer: DISCLAIMER,
    extracted: merged,
    refinementQuestion:
      (parsed.queryConfidence === "medium" || vagueRescue) && parsed.refinementQuestion?.trim()
        ? parsed.refinementQuestion.trim()
        : undefined,
    taxonomySummary:
      (parsed.queryConfidence === "medium" || vagueRescue) && parsed.taxonomySummary?.trim()
        ? parsed.taxonomySummary.trim()
        : undefined,
  };

  if (enableSearchDebug()) {
    matchResult.searchDebug = buildSearchResponseDebug({
      channel: "matcher",
      query: input.query,
      parsedQuery: parsed,
      degradedModes: degradedModes ?? [],
      latencyMs,
      rerankerVersion: MATCHER_RERANKER_VERSION,
      results: finalMatches,
      extracted: merged,
      appliedFilters: applied,
      clarificationDecision:
        applied?.practiceArea || applied?.city || applied?.language
          ? "skipped_filters"
          : "none",
    });
  }

  return matchResult;
}

function toMatch(
  r: RankedCandidate,
  explanation: string,
  loc: { location?: MatchLocation; mapMarker?: MapMarker },
): AnyMatch {
  if (r.kind === "lawyer") {
    const firmObj = r.lawyer.firm;
    const lawyerMatch: LawyerMatch = {
      kind: "lawyer",
      id: r.lawyer.id,
      name: r.lawyer.name,
      firm: firmObj?.name ?? null,
      firmSraVerified: firmObj?.sraId ? true : false,
      firmSraProfileUrl: firmObj?.sraProfileUrl ?? null,
      practiceAreas: r.lawyer.practiceAreas.map((p) => ({
        slug: p.practiceArea.slug,
        name: p.practiceArea.name,
      })),
      city: r.lawyer.locations[0]?.city ?? "",
      jurisdiction: r.lawyer.locations[0]?.jurisdiction ?? "",
      languages: r.lawyer.languages.map((l) => l.language.name),
      yearsExperience: r.lawyer.yearsExperience,
      rating: r.lawyer.rating,
      reviewCount: r.lawyer.reviewCount,
      consultationOptions: r.lawyer.consultationOptions,
      verifiedCredentials: r.lawyer.verifiedCredentials,
      profileUrl: r.lawyer.profileUrl,
      explanation,
      scoreBreakdown: r.breakdown,
      location: loc.location,
      mapMarker: loc.mapMarker,
    };
    return lawyerMatch;
  }

  const displayName = resolveSraDisplayName(
    r.org.businessName,
    r.org.searchText ?? "",
    r.org.sraId,
  );
  const phone =
    r.org.phone?.trim() || extractPhoneFromSraSearchText(r.org.searchText ?? "") || undefined;

  const orgMatch: OrgMatch = {
    kind: "org",
    id: r.org.id,
    sraId: r.org.sraId,
    businessName: displayName,
    phone,
    city: r.org.city,
    postcode: r.org.postcode,
    country: r.org.country,
    jurisdiction: r.inferredJurisdiction,
    sraProfileUrl: r.org.sraProfileUrl,
    explanation,
    scoreBreakdown: r.breakdown,
    location: loc.location,
    mapMarker: loc.mapMarker,
  };
  return orgMatch;
}

async function logInteraction(args: {
  sessionId?: string;
  query: string;
  extracted: ExtractedFilters;
  parsed?: ParsedQuery;
  clarifyingAsked: boolean;
  resultIds: string[];
  latencyMs?: number;
  degradedModes?: string[];
  mapUsed?: boolean;
}) {
  try {
    await prisma.searchInteraction.create({
      data: {
        userSessionId: args.sessionId ?? null,
        rawQuery: args.query.slice(0, 2000),
        extractedFilters: args.extracted as unknown as object,
        clarifyingAsked: args.clarifyingAsked,
        resultLawyerIds: args.resultIds,
        channel: "matcher",
        latencyMs: args.latencyMs ?? null,
        degradedModes: args.degradedModes?.length ? args.degradedModes : undefined,
        resultCount: args.resultIds.length,
        parsedQuery: args.parsed ? (args.parsed as object) : undefined,
        unifiedResultIds: [],
        mapUsed: args.mapUsed ?? null,
      },
    });
  } catch (err) {
    console.warn("[agent.workflow] failed to log SearchInteraction:", err);
  }
}
