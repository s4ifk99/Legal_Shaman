import type { PrismaClient } from "@prisma/client";
import { submitEnrichmentCandidate } from "@/lib/provider-enrichment/review-queue";
import type { EnrichmentCandidate, EnrichmentFieldName } from "@/lib/provider-enrichment/types";
import {
  buildYellEnrichmentQueries,
  searchYellListings,
  validateYellListingForEnrichment,
  type YellListingHit,
} from "@/lib/provider-enrichment/yell-listings";
import { classifySraStoredName, isPlaceholderSraDisplayName } from "@/lib/sra/sra-name-quality";

export type YellContactEnrichmentOptions = {
  limit?: number;
  dryRun?: boolean;
  entityId?: string;
  town?: string;
  postcode?: string;
  debug?: boolean;
};

export type YellContactEnrichmentResult = {
  event: "providers_enrich_yell";
  dryRun: boolean;
  scanned: number;
  listingsFound: number;
  listingsAccepted: number;
  candidatesSubmitted: number;
  autoApproved: number;
  pendingReview: number;
  rejected: number;
  skippedNoFirmName: number;
  samples: Record<string, unknown>[];
};

function approvedFirmName(row: {
  displayName: string;
  organisationName: string;
  businessName: string;
  sraId: string;
}): string | null {
  for (const n of [row.displayName, row.organisationName, row.businessName]) {
    const name = n.trim();
    if (!name) continue;
    if (isPlaceholderSraDisplayName(name, row.sraId)) continue;
    if (classifySraStoredName(name, row.sraId) !== "real_firm_name") continue;
    return name;
  }
  return null;
}

function enrichmentConfidence(matchScore: number, fieldName: EnrichmentFieldName): number {
  const base = matchScore >= 0.98 ? 0.97 : matchScore >= 0.9 ? 0.93 : 0.82;
  if (fieldName === "phone" && matchScore >= 0.95) return Math.min(0.99, base + 0.02);
  return base;
}

function listingToCandidates(
  entityId: string,
  listing: YellListingHit,
  matchScore: number,
  provenanceSuffix: string,
): EnrichmentCandidate[] {
  const out: EnrichmentCandidate[] = [];
  const note = `yell_match_score:${matchScore};${provenanceSuffix}`;

  if (listing.phone?.trim()) {
    out.push({
      entityId,
      entityType: "sra_organisation",
      fieldName: "phone",
      extractedValue: listing.phone.trim(),
      confidence: enrichmentConfidence(matchScore, "phone"),
      sourceUrl: listing.profileUrl,
      sourceType: "yell",
      extractionMethod: "html_parse",
      provenanceNote: note,
    });
  }

  if (listing.website?.trim()) {
    out.push({
      entityId,
      entityType: "sra_organisation",
      fieldName: "website",
      extractedValue: listing.website.trim(),
      confidence: enrichmentConfidence(matchScore, "website"),
      sourceUrl: listing.profileUrl,
      sourceType: "yell",
      extractionMethod: "html_parse",
      provenanceNote: note,
    });
  }

  if (listing.address?.trim()) {
    out.push({
      entityId,
      entityType: "sra_organisation",
      fieldName: "address",
      extractedValue: listing.address.trim(),
      confidence: enrichmentConfidence(matchScore, "address"),
      sourceUrl: listing.profileUrl,
      sourceType: "yell",
      extractionMethod: "html_parse",
      provenanceNote: note,
    });
  }

  out.push({
    entityId,
    entityType: "sra_organisation",
    fieldName: "contactPageUrl",
    extractedValue: listing.profileUrl,
    confidence: enrichmentConfidence(matchScore, "contactPageUrl"),
    sourceUrl: listing.profileUrl,
    sourceType: "yell",
    extractionMethod: "html_parse",
    provenanceNote: note,
  });

  return out;
}

export async function runYellContactEnrichment(
  prisma: PrismaClient,
  opts: YellContactEnrichmentOptions = {},
): Promise<YellContactEnrichmentResult> {
  const dryRun = opts.dryRun ?? false;
  const limit = Math.max(1, opts.limit ?? 50);

  const result: YellContactEnrichmentResult = {
    event: "providers_enrich_yell",
    dryRun,
    scanned: 0,
    listingsFound: 0,
    listingsAccepted: 0,
    candidatesSubmitted: 0,
    autoApproved: 0,
    pendingReview: 0,
    rejected: 0,
    skippedNoFirmName: 0,
    samples: [],
  };

  let rows = await prisma.sraOrganisation.findMany({
    select: {
      id: true,
      sraId: true,
      displayName: true,
      organisationName: true,
      businessName: true,
      city: true,
      postcode: true,
    },
    orderBy: { sraId: "asc" },
    take: limit * 4,
  });

  if (opts.entityId) {
    const sraId = opts.entityId.replace(/^sra:/i, "").trim();
    rows = rows.filter((r) => r.id === opts.entityId || r.sraId === sraId);
  }
  if (opts.town) {
    const town = opts.town.toLowerCase();
    rows = rows.filter((r) => r.city.toLowerCase().includes(town));
  }
  if (opts.postcode) {
    const pc = opts.postcode.replace(/\s+/g, "").toUpperCase();
    rows = rows.filter((r) => r.postcode.replace(/\s+/g, "").toUpperCase().includes(pc));
  }

  for (const row of rows) {
    if (result.scanned >= limit) break;
    const firmName = approvedFirmName(row);
    if (!firmName) {
      result.skippedNoFirmName++;
      continue;
    }

    result.scanned++;
    const entityId = row.id.startsWith("sra:") ? row.id : `sra:${row.sraId}`;
    const town = opts.town?.trim() || row.city;
    const postcode = opts.postcode?.trim() || row.postcode;

    const queries = buildYellEnrichmentQueries({ firmName, town, postcode });
    let bestListing: YellListingHit | undefined;
    let bestMatch = 0;

    for (const query of queries) {
      const listings = await searchYellListings(query);
      result.listingsFound += listings.length;

      for (const listing of listings) {
        const gate = validateYellListingForEnrichment(listing, firmName, postcode);
        if (!gate.ok) {
          if (opts.debug && result.samples.length < 8) {
            result.samples.push({
              sraId: row.sraId,
              firmName,
              yellName: listing.businessName,
              rejected: gate.reason,
            });
          }
          continue;
        }
        if (gate.match.score > bestMatch) {
          bestMatch = gate.match.score;
          bestListing = listing;
        }
      }
    }

    if (!bestListing) continue;
    result.listingsAccepted++;

    const candidates = listingToCandidates(
      entityId,
      bestListing,
      bestMatch,
      `approved_firm:${firmName}`,
    );

    if (result.samples.length < 10) {
      result.samples.push({
        sraId: row.sraId,
        approvedFirmName: firmName,
        yellListingName: bestListing.businessName,
        matchScore: bestMatch,
        profileUrl: bestListing.profileUrl,
        phone: bestListing.phone,
      });
    }

    if (dryRun) {
      result.candidatesSubmitted += candidates.length;
      if (bestMatch >= 0.95) result.autoApproved += candidates.length;
      else result.pendingReview += candidates.length;
      continue;
    }

    for (const c of candidates) {
      const submitted = await submitEnrichmentCandidate(c);
      result.candidatesSubmitted++;
      if (submitted.status === "auto_approved") result.autoApproved++;
      else if (submitted.status === "rejected") result.rejected++;
      else result.pendingReview++;
    }
  }

  return result;
}
