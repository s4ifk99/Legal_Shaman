import { extractWebsiteFromText } from "@/lib/provider-enrichment/contact-extractor";
import { discoverWebsiteViaLawSociety } from "@/lib/provider-enrichment-ladder/law-society-lookup";
import { ladderConfidence } from "@/lib/provider-enrichment-ladder/enrichment-confidence";
import { matchStructuredDirectories } from "@/lib/provider-osint/structured-directory-index";
import {
  scoreOfficialDomain,
  websiteNeedsReviewFromDomain,
  OFFICIAL_DOMAIN_AUTO_APPROVE,
} from "@/lib/provider-osint/official-domain-scoring";
import type { OsintWebsiteCandidate } from "@/lib/provider-osint/types";
import type { LegalEntityDocument } from "@/lib/search-index/types";
import type { EnrichmentSourceType } from "@/lib/provider-enrichment/types";

function toOsintCandidate(
  url: string,
  ctx: {
    sourceType: EnrichmentSourceType;
    sourceUrl: string;
    provenanceNote: string;
    extractionConfidence: number;
    firmName: string;
    postcode?: string;
    city?: string;
  },
): OsintWebsiteCandidate | null {
  const normalized = url.startsWith("http") ? url : `https://${url}`;
  let origin: string;
  try {
    origin = new URL(normalized).origin;
  } catch {
    return null;
  }

  const domain = scoreOfficialDomain(origin, ctx.firmName, {
    postcode: ctx.postcode,
    city: ctx.city,
  });

  const confidence = Math.min(
    1,
    Math.round(
      ladderConfidence({
        sourceType: ctx.sourceType,
        extractionConfidence: ctx.extractionConfidence,
        signal: "structured_field",
      }) *
        (0.65 + domain.score * 0.35) *
        100,
    ) / 100,
  );

  const needsReview =
    websiteNeedsReviewFromDomain(domain) || confidence < OFFICIAL_DOMAIN_AUTO_APPROVE;

  return {
    url: origin,
    confidence,
    sourceType: ctx.sourceType,
    sourceUrl: ctx.sourceUrl,
    provenanceNote: `${ctx.provenanceNote} | domainScore=${domain.score} [${domain.signals.join(",")}]`,
    needsReview,
    domainScore: domain.score,
  };
}

/** Step 1: SRA register fields. */
export function discoverFromSraRegister(doc: LegalEntityDocument): OsintWebsiteCandidate | null {
  if (doc.website?.trim()) {
    return toOsintCandidate(doc.website, {
      sourceType: "sra_register",
      sourceUrl: doc.profileUrl ?? doc.sraId ?? doc.id,
      provenanceNote: "SRA register website field",
      extractionConfidence: 0.95,
      firmName: doc.title,
      postcode: doc.postcode,
      city: doc.city,
    });
  }
  const fromText = extractWebsiteFromText(doc.searchText, doc.profileUrl);
  if (!fromText) return null;
  return toOsintCandidate(fromText, {
    sourceType: "sra_register",
    sourceUrl: doc.profileUrl ?? doc.searchText.slice(0, 200),
    provenanceNote: "Website in SRA search_text",
    extractionConfidence: 0.88,
    firmName: doc.title,
    postcode: doc.postcode,
    city: doc.city,
  });
}

/** Step 3: GOV.UK / structured directories (legal aid, LawWorks, curated). */
export function discoverFromStructuredDirectories(
  doc: LegalEntityDocument,
): OsintWebsiteCandidate | null {
  const matches = matchStructuredDirectories({
    title: doc.title,
    postcode: doc.postcode,
    city: doc.city,
    limit: 1,
  });
  const best = matches[0];
  if (!best?.website?.trim()) return null;
  return toOsintCandidate(best.website, {
    sourceType: best.sourceType,
    sourceUrl: best.sourceUrl,
    provenanceNote: best.provenanceNote,
    extractionConfidence: best.confidence,
    firmName: doc.title,
    postcode: doc.postcode,
    city: doc.city,
  });
}

/**
 * OSINT website discovery: exact firm name + postcode/city across approved public sources.
 */
export async function discoverWebsiteOsint(
  doc: LegalEntityDocument,
): Promise<OsintWebsiteCandidate | null> {
  const candidates: OsintWebsiteCandidate[] = [];

  const sra = discoverFromSraRegister(doc);
  if (sra) candidates.push(sra);

  if (doc.entityType === "sra_organisation") {
    const ls = await discoverWebsiteViaLawSociety({
      name: doc.title,
      city: doc.city,
      postcode: doc.postcode,
    });
    if (ls) {
      const osint = toOsintCandidate(ls.url, {
        sourceType: "law_society",
        sourceUrl: ls.sourceUrl,
        provenanceNote: ls.provenanceNote,
        extractionConfidence: 0.82,
        firmName: doc.title,
        postcode: doc.postcode,
        city: doc.city,
      });
      if (osint) candidates.push(osint);
    }
  }

  const structured = discoverFromStructuredDirectories(doc);
  if (structured) candidates.push(structured);

  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    if (a.needsReview !== b.needsReview) return a.needsReview ? 1 : -1;
    return b.confidence - a.confidence;
  });

  const best = candidates[0];
  if (best.needsReview) return best;

  const highConfidence = candidates.find((c) => !c.needsReview && c.confidence >= OFFICIAL_DOMAIN_AUTO_APPROVE);
  return highConfidence ?? best;
}
