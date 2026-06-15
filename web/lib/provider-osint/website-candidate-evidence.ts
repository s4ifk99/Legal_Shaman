import { isRegulatoryOrDirectoryUrl } from "@/lib/provider-enrichment/regulatory-url-filter";
import { scoreOfficialDomain } from "@/lib/provider-osint/official-domain-scoring";
import type { FirmNameSeed } from "@/lib/provider-osint/firm-name-seed";
import type { FirmWebSearchHit } from "@/lib/provider-osint/firm-web-search";
import { nameSimilarity } from "@/lib/provider-osint/name-normalize";
import { isSyntheticWebsiteDomain } from "@/lib/provider-osint/synthetic-domain";
import type { HomepageVerification } from "@/lib/provider-osint/homepage-verification";
import { rejectWebsiteForInvalidFirmSeed } from "@/lib/provider-osint/firm-name-seed-validation";
import {
  candidateMayEnterModeration,
  type WebsiteCandidateType,
} from "@/lib/provider-osint/website-candidate-types";

export type ScoredWebsiteCandidate = {
  url: string;
  confidence: number;
  candidateType: WebsiteCandidateType;
  matchedFirmTokens: string[];
  matchedLocation: boolean;
  mayPersist: boolean;
  rejectReason?: string;
  provenanceNote: string;
  searchQuery?: string;
  domainScore: number;
};

export function scoreRegistryWebsiteCandidate(
  url: string,
  seed: FirmNameSeed,
  provenanceNote: string,
): ScoredWebsiteCandidate | null {
  const seedGate = rejectWebsiteForInvalidFirmSeed(url, seed.primaryName, seed.sraId ?? "");
  if (seedGate.reject) {
    return {
      url,
      confidence: 0,
      candidateType: "registry_supplied",
      matchedFirmTokens: [],
      matchedLocation: false,
      mayPersist: false,
      rejectReason: seedGate.reason,
      provenanceNote,
      domainScore: 0,
    };
  }

  if (isRegulatoryOrDirectoryUrl(url)) {
    return null;
  }
  const synthetic = isSyntheticWebsiteDomain(url, seed.primaryName, {
    postcode: seed.postcode,
    city: seed.city,
    sraId: seed.sraId,
  });
  if (synthetic.synthetic) {
    return {
      url,
      confidence: 0,
      candidateType: "registry_supplied",
      matchedFirmTokens: [],
      matchedLocation: false,
      mayPersist: false,
      rejectReason: synthetic.reason,
      provenanceNote,
      domainScore: 0,
    };
  }

  const domain = scoreOfficialDomain(url, seed.primaryName, {
    postcode: seed.postcode,
    city: seed.city,
  });
  if (domain.isDirectory) return null;

  const confidence = Math.min(1, Math.round((0.72 + domain.score * 0.26) * 100) / 100);
  return {
    url,
    confidence,
    candidateType: "registry_supplied",
    matchedFirmTokens: domain.signals.filter((s) => s.startsWith("host_contains:")).map((s) => s.split(":")[1]!),
    matchedLocation: Boolean(seed.postcode || seed.city),
    mayPersist: candidateMayEnterModeration("registry_supplied", confidence),
    provenanceNote,
    domainScore: domain.score,
  };
}

export function scoreSearchResultCandidate(
  hit: FirmWebSearchHit,
  seed: FirmNameSeed,
  verification?: HomepageVerification,
): ScoredWebsiteCandidate | null {
  const url = hit.url;
  const seedGate = rejectWebsiteForInvalidFirmSeed(url, seed.primaryName, seed.sraId ?? "");
  if (seedGate.reject) {
    return {
      url,
      confidence: 0,
      candidateType: "search_result",
      matchedFirmTokens: [],
      matchedLocation: false,
      mayPersist: false,
      rejectReason: seedGate.reason,
      provenanceNote: `search:${hit.query}`,
      searchQuery: hit.query,
      domainScore: 0,
    };
  }

  if (isRegulatoryOrDirectoryUrl(url)) return null;

  const synthetic = isSyntheticWebsiteDomain(url, seed.primaryName, {
    postcode: seed.postcode,
    city: seed.city,
    sraId: seed.sraId,
  });
  if (synthetic.synthetic) {
    return {
      url,
      confidence: 0,
      candidateType: "search_result",
      matchedFirmTokens: [],
      matchedLocation: false,
      mayPersist: false,
      rejectReason: synthetic.reason,
      provenanceNote: `search:${hit.query}`,
      searchQuery: hit.query,
      domainScore: 0,
    };
  }

  const domain = scoreOfficialDomain(url, seed.primaryName, {
    postcode: seed.postcode,
    city: seed.city,
  });
  if (domain.isDirectory) return null;

  const titleSim = hit.title ? nameSimilarity(seed.primaryName, hit.title) : 0;
  let confidence = 0.45 + domain.score * 0.35 + titleSim * 0.2;

  const matchedFirmTokens = domain.signals
    .filter((s) => s.startsWith("host_contains:"))
    .map((s) => s.split(":")[1]!);

  let matchedLocation = false;
  let candidateType: WebsiteCandidateType = "search_result";

  if (verification?.verified) {
    candidateType = "page_verified";
    confidence += 0.15;
    matchedLocation = verification.matchedLocation;
    for (const t of verification.matchedFirmTokens) {
      if (!matchedFirmTokens.includes(t)) matchedFirmTokens.push(t);
    }
    if (verification.hasLegalKeywords) confidence += 0.05;
  } else if (verification && !verification.fetchOk) {
    confidence -= 0.08;
  } else if (matchedFirmTokens.length === 0 && titleSim < 0.25) {
    return {
      url,
      confidence: Math.round(confidence * 100) / 100,
      candidateType: "search_result",
      matchedFirmTokens: [],
      matchedLocation: false,
      mayPersist: false,
      rejectReason: "no_firm_name_evidence",
      provenanceNote: `search:${hit.query}`,
      searchQuery: hit.query,
      domainScore: domain.score,
    };
  }

  if (seed.city && hit.snippet.toLowerCase().includes(seed.city.toLowerCase())) {
    matchedLocation = true;
    confidence += 0.04;
  }

  confidence = Math.min(1, Math.round(confidence * 100) / 100);

  return {
    url,
    confidence,
    candidateType,
    matchedFirmTokens,
    matchedLocation,
    mayPersist: candidateMayEnterModeration(candidateType, confidence),
    provenanceNote: `search:${hit.query} | title=${hit.title.slice(0, 80)}`,
    searchQuery: hit.query,
    domainScore: domain.score,
  };
}

export function pickBestScoredCandidate(
  candidates: ScoredWebsiteCandidate[],
): ScoredWebsiteCandidate | null {
  const persistable = candidates.filter((c) => c.mayPersist && c.confidence > 0);
  if (!persistable.length) return null;

  persistable.sort((a, b) => {
    const typeOrder: Record<WebsiteCandidateType, number> = {
      page_verified: 0,
      registry_supplied: 1,
      search_result: 2,
      heuristic_guess: 3,
    };
    const ta = typeOrder[a.candidateType];
    const tb = typeOrder[b.candidateType];
    if (ta !== tb) return ta - tb;
    return b.confidence - a.confidence;
  });

  return persistable[0] ?? null;
}
