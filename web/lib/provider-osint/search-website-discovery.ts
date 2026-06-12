import { extractWebsiteFromText } from "@/lib/provider-enrichment/contact-extractor";
import { isRegulatoryOrDirectoryUrl, sraRegisterProvenanceUrl } from "@/lib/provider-enrichment/regulatory-url-filter";
import { enrichFirmNameSeedFromPostgres, type FirmNameSeed } from "@/lib/provider-osint/firm-name-seed";
import {
  INVALID_FIRM_NAME_SEED_REASON,
  rejectFirmNameSeed,
  rejectWebsiteForInvalidFirmSeed,
} from "@/lib/provider-osint/firm-name-seed-validation";
import { buildFirmWebsiteSearchQueries } from "@/lib/provider-osint/firm-search-queries";
import { searchWebForFirmQueries } from "@/lib/provider-osint/firm-web-search";
import { verifyFirmWebsiteHomepage } from "@/lib/provider-osint/homepage-verification";
import {
  pickBestScoredCandidate,
  scoreRegistryWebsiteCandidate,
  scoreSearchResultCandidate,
  type ScoredWebsiteCandidate,
} from "@/lib/provider-osint/website-candidate-evidence";
import { isSyntheticWebsiteDomain } from "@/lib/provider-osint/synthetic-domain";
import type { OsintWebsiteCandidate } from "@/lib/provider-osint/types";
import type { LegalEntityDocument } from "@/lib/search-index/types";

export type WebsiteCandidateDebugEntry = {
  url: string;
  candidateType: string;
  score: number;
  mayPersist: boolean;
  rejectReason?: string;
  source: "registry" | "search" | "law_society" | "sra_ladder";
  verified?: boolean;
};

export type FirmWebsiteSearchQueryDebug = {
  query: string;
  provider: "serper" | "duckduckgo" | "none";
  resultCount: number;
  first3Results: { title: string; link: string }[];
  ok: boolean;
  error?: string;
};

export type FirmWebsiteDiscoveryTrace = {
  providerId: string;
  displayName: string;
  queries: string[];
  searchProvider: "serper" | "duckduckgo" | "mixed" | "none";
  apiConfigured: boolean;
  searchesAttempted: number;
  searchesSucceeded: number;
  searchesFailed: number;
  totalResultsReturned: number;
  querySearchDebug: FirmWebsiteSearchQueryDebug[];
  searchResultsSeen: number;
  searchResultUrls: string[];
  candidateUrls: string[];
  candidateTypes: string[];
  candidateScores: number[];
  candidateEntries: WebsiteCandidateDebugEntry[];
  /** Selected candidate after scoring (before moderation). */
  candidateUrl?: string;
  candidateType?: string;
  confidence?: number;
  matchedFirmTokens?: string[];
  matchedLocation?: boolean;
  rejectReason?: string;
  /** persist outcome: auto_approved | pending_review | rejected | no_candidate */
  finalDecision?: string;
  candidatesCollected: number;
  candidatesVerified: number;
  candidatesRejected: number;
  noCandidate: boolean;
};

export function emptyWebsiteDiscoveryTrace(
  providerId: string,
  displayName: string,
): FirmWebsiteDiscoveryTrace {
  return {
    providerId,
    displayName,
    queries: [],
    searchProvider: "none",
    apiConfigured: false,
    searchesAttempted: 0,
    searchesSucceeded: 0,
    searchesFailed: 0,
    totalResultsReturned: 0,
    querySearchDebug: [],
    searchResultsSeen: 0,
    searchResultUrls: [],
    candidateUrls: [],
    candidateTypes: [],
    candidateScores: [],
    candidateEntries: [],
    candidatesCollected: 0,
    candidatesVerified: 0,
    candidatesRejected: 0,
    noCandidate: false,
  };
}

export function recordTraceCandidate(
  trace: FirmWebsiteDiscoveryTrace | undefined,
  entry: WebsiteCandidateDebugEntry,
): void {
  if (!trace) return;
  trace.candidatesCollected++;
  trace.candidateEntries.push(entry);
  trace.candidateUrls.push(entry.url);
  trace.candidateTypes.push(entry.candidateType);
  trace.candidateScores.push(entry.score);
  if (!entry.mayPersist || entry.rejectReason) {
    trace.candidatesRejected++;
  }
}

export type FirmWebsiteDiscoveryRunMetrics = {
  firmNamesUsed: number;
  searchQueriesBuilt: number;
  searchResultsSeen: number;
  candidatesVerified: number;
  rejectedSynthetic: number;
  rejectedRegulatory: number;
  rejectedUnverified: number;
  noCandidate: number;
};

function scoredToOsint(
  scored: ScoredWebsiteCandidate,
  seed: FirmNameSeed,
  sourceUrl: string,
): OsintWebsiteCandidate {
  return {
    url: scored.url,
    confidence: scored.confidence,
    sourceType: scored.candidateType === "registry_supplied" ? "sra_register" : "provider_website",
    sourceUrl,
    provenanceNote: `${scored.provenanceNote} | candidateType=${scored.candidateType}`,
    needsReview: true,
    domainScore: scored.domainScore,
    candidateType: scored.candidateType,
    matchedFirmTokens: scored.matchedFirmTokens,
    matchedLocation: scored.matchedLocation,
    rejectReason: scored.rejectReason,
    searchQuery: scored.searchQuery,
    firmNameUsed: seed.primaryName,
  };
}

/** Firm-name search discovery — no SRA-id / postcode / city domain guessing. */
export async function discoverWebsitesFromFirmNameSearch(
  doc: LegalEntityDocument,
  metrics?: FirmWebsiteDiscoveryRunMetrics,
  trace?: FirmWebsiteDiscoveryTrace,
): Promise<OsintWebsiteCandidate | null> {
  const seed = await enrichFirmNameSeedFromPostgres(doc);
  if (!seed) {
    if (metrics) metrics.noCandidate++;
    if (trace) {
      trace.rejectReason = INVALID_FIRM_NAME_SEED_REASON;
      trace.noCandidate = true;
    }
    return null;
  }

  const seedReject = rejectFirmNameSeed(seed.primaryName, seed.sraId ?? "");
  if (!seedReject.valid) {
    if (metrics) metrics.noCandidate++;
    if (trace) {
      trace.rejectReason = INVALID_FIRM_NAME_SEED_REASON;
      trace.noCandidate = true;
    }
    return null;
  }

  if (metrics) metrics.firmNamesUsed++;

  if (trace) {
    trace.providerId = doc.id;
    trace.displayName = seed.primaryName;
  }

  const registerUrl = sraRegisterProvenanceUrl(doc) ?? doc.profileUrl ?? doc.id;
  const scored: ScoredWebsiteCandidate[] = [];

  if (doc.website?.trim() && !isRegulatoryOrDirectoryUrl(doc.website)) {
    const reg = scoreRegistryWebsiteCandidate(
      doc.website.trim(),
      seed,
      "SRA organisation record website field",
    );
    if (reg) {
      recordTraceCandidate(trace, {
        url: reg.url,
        candidateType: reg.candidateType,
        score: reg.confidence,
        mayPersist: reg.mayPersist,
        rejectReason: reg.rejectReason,
        source: "registry",
      });
      if (reg.rejectReason?.includes("synthetic") || reg.rejectReason?.includes("postcode") || reg.rejectReason?.includes("sra_id")) {
        if (metrics) metrics.rejectedSynthetic++;
      } else if (!reg.mayPersist) {
        if (metrics) metrics.rejectedUnverified++;
      } else {
        scored.push(reg);
      }
    }
  }

  const fromText = extractWebsiteFromText(doc.searchText ?? "");
  if (fromText && !isRegulatoryOrDirectoryUrl(fromText)) {
    const reg = scoreRegistryWebsiteCandidate(fromText, seed, "URL in SRA register search text");
    if (reg) {
      recordTraceCandidate(trace, {
        url: reg.url,
        candidateType: reg.candidateType,
        score: reg.confidence,
        mayPersist: reg.mayPersist,
        rejectReason: reg.rejectReason,
        source: "registry",
      });
    }
    if (reg?.mayPersist) scored.push(reg);
    else if (reg && isSyntheticWebsiteDomain(fromText, seed.primaryName, { sraId: seed.sraId, postcode: seed.postcode, city: seed.city }).synthetic) {
      if (metrics) metrics.rejectedSynthetic++;
    }
  }

  const queries = buildFirmWebsiteSearchQueries(seed);
  if (trace) trace.queries = queries;
  if (metrics) metrics.searchQueriesBuilt += queries.length;

  if (queries.length) {
    const searchRun = await searchWebForFirmQueries(queries);
    if (metrics) metrics.searchResultsSeen += searchRun.hits.length;
    if (trace) {
      trace.searchResultsSeen = searchRun.hits.length;
      trace.searchResultUrls = searchRun.hits.map((h) => h.url);
      trace.searchProvider = searchRun.searchProvider;
      trace.apiConfigured = searchRun.apiConfigured;
      trace.searchesAttempted = searchRun.searchesAttempted;
      trace.searchesSucceeded = searchRun.searchesSucceeded;
      trace.searchesFailed = searchRun.searchesFailed;
      trace.totalResultsReturned = searchRun.totalResultsReturned;
      trace.querySearchDebug = searchRun.queryTraces;
    }
    const hits = searchRun.hits;
    void searchRun.queriesRun;

    for (const hit of hits.slice(0, 6)) {
      const verification = await verifyFirmWebsiteHomepage(hit.url, seed);
      if (verification.verified) {
        if (metrics) metrics.candidatesVerified++;
        if (trace) trace.candidatesVerified++;
      }

      const candidate = scoreSearchResultCandidate(hit, seed, verification);
      if (!candidate) continue;

      recordTraceCandidate(trace, {
        url: candidate.url,
        candidateType: candidate.candidateType,
        score: candidate.confidence,
        mayPersist: candidate.mayPersist,
        rejectReason: candidate.rejectReason,
        source: "search",
        verified: verification.verified,
      });

      if (candidate.rejectReason && isSyntheticWebsiteDomain(hit.url, seed.primaryName, { sraId: seed.sraId, postcode: seed.postcode, city: seed.city }).synthetic) {
        if (metrics) metrics.rejectedSynthetic++;
        continue;
      }
      if (isRegulatoryOrDirectoryUrl(hit.url)) {
        if (metrics) metrics.rejectedRegulatory++;
        continue;
      }
      if (!candidate.mayPersist) {
        if (metrics) metrics.rejectedUnverified++;
        continue;
      }
      scored.push(candidate);
    }

  }

  const best = pickBestScoredCandidate(scored);
  if (!best) {
    if (metrics) metrics.noCandidate++;
    if (trace) {
      trace.rejectReason = "no_verified_candidate";
      trace.noCandidate = true;
    }
    return null;
  }

  if (trace) {
    trace.candidateUrl = best.url;
    trace.candidateType = best.candidateType;
    trace.confidence = best.confidence;
    trace.matchedFirmTokens = best.matchedFirmTokens;
    trace.matchedLocation = best.matchedLocation;
    trace.noCandidate = false;
  }

  return scoredToOsint(best, seed, registerUrl);
}

export function pickBestWebsiteCandidate(
  candidates: OsintWebsiteCandidate[],
): OsintWebsiteCandidate | null {
  const valid = candidates.filter(
    (c) => c.url && !isRegulatoryOrDirectoryUrl(c.url) && c.candidateType !== "heuristic_guess",
  );
  if (!valid.length) return null;

  valid.sort((a, b) => b.confidence - a.confidence);
  return valid[0] ?? null;
}

/** @deprecated Heuristic domain guessing removed — always returns null. */
export function discoverWebsiteFromFirmNameHeuristic(
  _doc: LegalEntityDocument,
): OsintWebsiteCandidate | null {
  return null;
}
