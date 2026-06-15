import { extractWebsiteFromText } from "@/lib/provider-enrichment/contact-extractor";
import {
  isRegulatoryOrDirectoryUrl,
  sraRegisterProvenanceUrl,
} from "@/lib/provider-enrichment/regulatory-url-filter";
import { discoverWebsiteViaLawSociety } from "@/lib/provider-enrichment-ladder/law-society-lookup";
import { discoverFromSraFields } from "@/lib/provider-enrichment-ladder/official-website-discovery";
import { scoreOfficialDomain } from "@/lib/provider-osint/official-domain-scoring";
import {
  discoverWebsitesFromFirmNameSearch,
  pickBestWebsiteCandidate,
  recordTraceCandidate,
  type FirmWebsiteDiscoveryRunMetrics,
  type FirmWebsiteDiscoveryTrace,
} from "@/lib/provider-osint/search-website-discovery";
import {
  scoreRegistryWebsiteCandidate,
  type ScoredWebsiteCandidate,
} from "@/lib/provider-osint/website-candidate-evidence";
import { enrichFirmNameSeedFromPostgres, resolveFirmNameSeed } from "@/lib/provider-osint/firm-name-seed";
import {
  INVALID_FIRM_NAME_SEED_REASON,
  isValidFirmNameSeed,
} from "@/lib/provider-osint/firm-name-seed-validation";
import { isSyntheticWebsiteDomain } from "@/lib/provider-osint/synthetic-domain";
import type { OsintWebsiteCandidate } from "@/lib/provider-osint/types";
import type { LegalEntityDocument } from "@/lib/search-index/types";
import type { EnrichmentSourceType } from "@/lib/provider-enrichment/types";

export type WebsiteDiscoveryDiagnostics = {
  candidatesFound: number;
  candidatesCollected: number;
  candidatesRejected: number;
  regulatoryRejected: number;
  directoryRejected: number;
  rejectedSynthetic: number;
  rejectedUnverified: number;
  noCandidate: number;
  pendingReview: number;
  autoApproved: number;
  firmNamesUsed: number;
  searchQueriesBuilt: number;
  searchResultsSeen: number;
  candidatesVerified: number;
};

export function emptyWebsiteDiscoveryDiagnostics(): WebsiteDiscoveryDiagnostics {
  return {
    candidatesFound: 0,
    candidatesCollected: 0,
    candidatesRejected: 0,
    regulatoryRejected: 0,
    directoryRejected: 0,
    rejectedSynthetic: 0,
    rejectedUnverified: 0,
    noCandidate: 0,
    pendingReview: 0,
    autoApproved: 0,
    firmNamesUsed: 0,
    searchQueriesBuilt: 0,
    searchResultsSeen: 0,
    candidatesVerified: 0,
  };
}

export function mergeWebsiteDiscoveryDiagnostics(
  target: WebsiteDiscoveryDiagnostics,
  patch: Partial<WebsiteDiscoveryDiagnostics>,
): void {
  for (const key of Object.keys(patch) as (keyof WebsiteDiscoveryDiagnostics)[]) {
    const v = patch[key];
    if (typeof v === "number") target[key] += v;
  }
}

function mergeFirmMetrics(
  target: WebsiteDiscoveryDiagnostics,
  m: FirmWebsiteDiscoveryRunMetrics,
): void {
  target.firmNamesUsed += m.firmNamesUsed;
  target.searchQueriesBuilt += m.searchQueriesBuilt;
  target.searchResultsSeen += m.searchResultsSeen;
  target.candidatesVerified += m.candidatesVerified;
  target.rejectedSynthetic += m.rejectedSynthetic;
  target.regulatoryRejected += m.rejectedRegulatory;
  target.rejectedUnverified += m.rejectedUnverified;
  target.noCandidate += m.noCandidate;
}

function scoredToOsint(
  scored: ScoredWebsiteCandidate,
  sourceType: EnrichmentSourceType,
  sourceUrl: string,
  firmName: string,
): OsintWebsiteCandidate {
  return {
    url: scored.url.startsWith("http") ? new URL(scored.url).origin : scored.url,
    confidence: scored.confidence,
    sourceType,
    sourceUrl,
    provenanceNote: `${scored.provenanceNote} | candidateType=${scored.candidateType}`,
    needsReview: true,
    domainScore: scored.domainScore,
    candidateType: scored.candidateType,
    matchedFirmTokens: scored.matchedFirmTokens,
    matchedLocation: scored.matchedLocation,
    firmNameUsed: firmName,
  };
}

/** SRA register field — never treat SRA homepage as firm website. */
export async function discoverFromSraRegister(
  doc: LegalEntityDocument,
): Promise<OsintWebsiteCandidate | null> {
  const seed = await enrichFirmNameSeedFromPostgres(doc);
  if (!seed) return null;

  const registerUrl = sraRegisterProvenanceUrl(doc);
  const scored: ScoredWebsiteCandidate[] = [];

  if (doc.website?.trim() && !isRegulatoryOrDirectoryUrl(doc.website)) {
    const reg = scoreRegistryWebsiteCandidate(
      doc.website.trim(),
      seed,
      "SRA organisation record website field",
    );
    if (reg?.mayPersist) scored.push(reg);
  }

  const fromText = extractWebsiteFromText(doc.searchText ?? "");
  if (fromText && !isRegulatoryOrDirectoryUrl(fromText)) {
    const reg = scoreRegistryWebsiteCandidate(fromText, seed, "URL in SRA register search text");
    if (reg?.mayPersist) scored.push(reg);
  }

  const best = scored.sort((a, b) => b.confidence - a.confidence)[0];
  if (!best) return null;

  return scoredToOsint(best, "sra_register", registerUrl ?? best.url, seed.primaryName);
}

export async function discoverWebsiteOsint(
  doc: LegalEntityDocument,
  opts?: {
    metrics?: WebsiteDiscoveryDiagnostics;
    trace?: FirmWebsiteDiscoveryTrace;
  },
): Promise<OsintWebsiteCandidate | null> {
  const seed = await enrichFirmNameSeedFromPostgres(doc);
  if (!seed) {
    if (opts?.trace) {
      opts.trace.rejectReason = INVALID_FIRM_NAME_SEED_REASON;
      opts.trace.noCandidate = true;
    }
    return null;
  }
  if (!isValidFirmNameSeed(seed.primaryName, seed.sraId ?? "")) {
    if (opts?.trace) {
      opts.trace.rejectReason = INVALID_FIRM_NAME_SEED_REASON;
      opts.trace.noCandidate = true;
    }
    return null;
  }

  const firmMetrics: FirmWebsiteDiscoveryRunMetrics = {
    firmNamesUsed: 0,
    searchQueriesBuilt: 0,
    searchResultsSeen: 0,
    candidatesVerified: 0,
    rejectedSynthetic: 0,
    rejectedRegulatory: 0,
    rejectedUnverified: 0,
    noCandidate: 0,
  };

  const candidates: OsintWebsiteCandidate[] = [];

  const searchHit = await discoverWebsitesFromFirmNameSearch(doc, firmMetrics, opts?.trace);
  if (searchHit) candidates.push(searchHit);

  const ladderSra = await discoverFromSraFields(doc);
  if (ladderSra?.url && !isRegulatoryOrDirectoryUrl(ladderSra.url)) {
    const reg = scoreRegistryWebsiteCandidate(ladderSra.url, seed, ladderSra.provenanceNote);
    if (reg) {
      recordTraceCandidate(opts?.trace, {
        url: reg.url,
        candidateType: reg.candidateType,
        score: reg.confidence,
        mayPersist: reg.mayPersist,
        rejectReason: reg.rejectReason,
        source: "sra_ladder",
      });
    }
    if (reg?.mayPersist) {
      candidates.push(
        scoredToOsint(reg, "sra_register", ladderSra.sourceUrl, seed.primaryName),
      );
    } else if (reg && isSyntheticWebsiteDomain(ladderSra.url, seed.primaryName, { sraId: seed.sraId }).synthetic) {
      firmMetrics.rejectedSynthetic++;
    }
  }

  const lawSoc = await discoverWebsiteViaLawSociety({
    name: seed.primaryName,
    city: seed.city,
    postcode: seed.postcode,
  });
  if (lawSoc?.url && !isRegulatoryOrDirectoryUrl(lawSoc.url)) {
    const reg = scoreRegistryWebsiteCandidate(lawSoc.url, seed, lawSoc.provenanceNote);
    if (reg) {
      recordTraceCandidate(opts?.trace, {
        url: reg.url,
        candidateType: reg.candidateType,
        score: reg.confidence,
        mayPersist: reg.mayPersist,
        rejectReason: reg.rejectReason,
        source: "law_society",
      });
    }
    if (reg?.mayPersist) {
      candidates.push(
        scoredToOsint(reg, "law_society", lawSoc.sourceUrl, seed.primaryName),
      );
    }
  }

  if (opts?.metrics) {
    mergeFirmMetrics(opts.metrics, firmMetrics);
    if (opts.trace) {
      opts.metrics.candidatesCollected += opts.trace.candidatesCollected;
      opts.metrics.candidatesRejected += opts.trace.candidatesRejected;
    }
  }

  const best = pickBestWebsiteCandidate(candidates);
  if (!best && opts?.trace) {
    opts.trace.noCandidate = true;
    if (!opts.trace.rejectReason) opts.trace.rejectReason = "no_osint_candidate";
  }
  return best;
}

export function classifyWebsiteDiscoveryAttempt(
  doc: LegalEntityDocument,
): { regulatoryRejected: boolean; directoryRejected: boolean; syntheticRejected: boolean } {
  const raw =
    doc.website?.trim() ||
    extractWebsiteFromText(doc.searchText ?? "");

  if (!raw) return { regulatoryRejected: false, directoryRejected: false, syntheticRejected: false };
  if (isRegulatoryOrDirectoryUrl(raw)) {
    return { regulatoryRejected: true, directoryRejected: false, syntheticRejected: false };
  }

  const seed = resolveFirmNameSeed(doc);
  if (
    seed &&
    isSyntheticWebsiteDomain(raw, seed.primaryName, {
      sraId: seed.sraId,
      postcode: seed.postcode,
      city: seed.city,
    }).synthetic
  ) {
    return { regulatoryRejected: false, directoryRejected: false, syntheticRejected: true };
  }

  const domain = scoreOfficialDomain(raw, doc.title, {
    postcode: doc.postcode,
    city: doc.city,
  });
  if (domain.isDirectory) {
    return { regulatoryRejected: false, directoryRejected: true, syntheticRejected: false };
  }

  return { regulatoryRejected: false, directoryRejected: false, syntheticRejected: false };
}
