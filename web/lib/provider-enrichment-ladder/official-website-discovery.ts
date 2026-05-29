import {
  discoverFromSraRegister,
  discoverWebsiteOsint,
} from "@/lib/provider-osint/website-discovery";
import type { WebsiteDiscoveryCandidate } from "@/lib/provider-enrichment-ladder/types";
import type { LegalEntityDocument } from "@/lib/search-index/types";
import type { EnrichmentSourceType } from "@/lib/provider-enrichment/types";

function mapOsintToLadder(
  c: Awaited<ReturnType<typeof discoverWebsiteOsint>>,
): WebsiteDiscoveryCandidate | null {
  if (!c) return null;
  return {
    url: c.url,
    confidence: c.confidence,
    sourceType: c.sourceType as WebsiteDiscoveryCandidate["sourceType"],
    sourceUrl: c.sourceUrl,
    provenanceNote: c.provenanceNote,
    needsReview: c.needsReview,
  };
}

/** Priority 1: existing SRA / structured fields (re-export for eval). */
export function discoverFromSraFields(doc: LegalEntityDocument): WebsiteDiscoveryCandidate | null {
  return mapOsintToLadder(discoverFromSraRegister(doc));
}

/** Full OSINT website discovery ladder. */
export async function discoverOfficialWebsite(
  doc: LegalEntityDocument,
): Promise<WebsiteDiscoveryCandidate | null> {
  return mapOsintToLadder(await discoverWebsiteOsint(doc));
}

export type { EnrichmentSourceType };
