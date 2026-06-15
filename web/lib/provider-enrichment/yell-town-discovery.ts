import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { submitEnrichmentCandidate } from "@/lib/provider-enrichment/review-queue";
import type { EnrichmentCandidate } from "@/lib/provider-enrichment/types";
import {
  buildYellTownDiscoveryQueries,
  normaliseFirmNameKey,
  searchYellListings,
  validateYellDiscoveryListing,
} from "@/lib/provider-enrichment/yell-listings";

export type YellTownDiscoveryOptions = {
  town?: string;
  postcode?: string;
  limit?: number;
  dryRun?: boolean;
  debug?: boolean;
};

export type YellTownDiscoveryResult = {
  event: "providers_discover_yell_town";
  dryRun: boolean;
  town: string | null;
  postcode: string | null;
  listingsFound: number;
  discoveriesCreated: number;
  matchedExisting: number;
  pendingReview: number;
  rejected: number;
  samples: Record<string, unknown>[];
};

function discoveryEntityId(town: string, businessName: string): string {
  const key = `${town}:${normaliseFirmNameKey(businessName)}`;
  const hash = createHash("sha256").update(key).digest("hex").slice(0, 12);
  return `yell-discovery:${hash}`;
}

async function findMatchingSraOrg(
  prisma: PrismaClient,
  businessName: string,
  postcode: string,
): Promise<{ entityId: string; firmName: string } | null> {
  const rows = await prisma.sraOrganisation.findMany({
    where: postcode ? { postcode: { contains: postcode.slice(0, 4), mode: "insensitive" } } : {},
    select: {
      id: true,
      sraId: true,
      displayName: true,
      organisationName: true,
      postcode: true,
    },
    take: 200,
  });

  const key = normaliseFirmNameKey(businessName);
  for (const row of rows) {
    for (const name of [row.displayName, row.organisationName]) {
      if (normaliseFirmNameKey(name) === key) {
        return { entityId: row.id, firmName: name };
      }
    }
  }
  return null;
}

export async function runYellTownDiscovery(
  prisma: PrismaClient,
  opts: YellTownDiscoveryOptions = {},
): Promise<YellTownDiscoveryResult> {
  const town = opts.town?.trim() || "";
  const postcode = opts.postcode?.trim() || "";
  if (!town && !postcode) {
    throw new Error("town or postcode required for Yell town discovery");
  }

  const dryRun = opts.dryRun ?? false;
  const limit = Math.max(1, opts.limit ?? 50);

  const result: YellTownDiscoveryResult = {
    event: "providers_discover_yell_town",
    dryRun,
    town: town || null,
    postcode: postcode || null,
    listingsFound: 0,
    discoveriesCreated: 0,
    matchedExisting: 0,
    pendingReview: 0,
    rejected: 0,
    samples: [],
  };

  const queries = buildYellTownDiscoveryQueries({ town, postcode });
  const seen = new Set<string>();
  const locationLabel = town || postcode;

  for (const query of queries) {
    if (result.discoveriesCreated >= limit) break;
    const listings = await searchYellListings(query);
    result.listingsFound += listings.length;

    for (const listing of listings) {
      if (result.discoveriesCreated >= limit) break;
      if (seen.has(listing.profileUrl)) continue;

      const gate = validateYellDiscoveryListing(listing, postcode || undefined);
      if (!gate.ok) continue;

      seen.add(listing.profileUrl);

      const existing = await findMatchingSraOrg(prisma, listing.businessName, postcode);
      if (existing) {
        result.matchedExisting++;
        if (opts.debug && result.samples.length < 8) {
          result.samples.push({
            matched: true,
            sraEntityId: existing.entityId,
            yellName: listing.businessName,
          });
        }
        continue;
      }

      const entityId = discoveryEntityId(locationLabel, listing.businessName);
      const candidate: EnrichmentCandidate = {
        entityId,
        entityType: "yell_town_discovery",
        fieldName: "discovered_firm_name",
        extractedValue: listing.businessName,
        confidence: 0.75,
        sourceUrl: listing.profileUrl,
        sourceType: "yell",
        extractionMethod: "html_parse",
        provenanceNote: `yell_town:${locationLabel};address:${listing.address ?? ""}`,
      };

      if (result.samples.length < 12) {
        result.samples.push({
          entityId,
          yellName: listing.businessName,
          profileUrl: listing.profileUrl,
          town: locationLabel,
        });
      }

      if (dryRun) {
        result.discoveriesCreated++;
        result.pendingReview++;
        continue;
      }

      const submitted = await submitEnrichmentCandidate(candidate);
      if (submitted.status === "rejected") result.rejected++;
      else {
        result.discoveriesCreated++;
        result.pendingReview++;
      }
    }
  }

  return result;
}
