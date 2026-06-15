import { enrichFirmNameSeedFromPostgres } from "@/lib/provider-osint/firm-name-seed";
import { buildFirmWebsiteSearchQueries } from "@/lib/provider-osint/firm-search-queries";
import {
  discoverFromSraRegister,
  discoverWebsiteOsint,
  emptyWebsiteDiscoveryDiagnostics,
  type WebsiteDiscoveryDiagnostics,
} from "@/lib/provider-osint/website-discovery";
import type { FirmWebsiteDiscoveryTrace } from "@/lib/provider-osint/search-website-discovery";
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
export async function discoverFromSraFields(
  doc: LegalEntityDocument,
): Promise<WebsiteDiscoveryCandidate | null> {
  const c = await discoverFromSraRegister(doc);
  return mapOsintToLadder(c);
}

/** Full OSINT website discovery ladder. */
export async function discoverOfficialWebsite(
  doc: LegalEntityDocument,
  opts?: { metrics?: WebsiteDiscoveryDiagnostics; trace?: FirmWebsiteDiscoveryTrace },
): Promise<WebsiteDiscoveryCandidate | null> {
  const seed = await enrichFirmNameSeedFromPostgres(doc);
  if (seed && opts?.metrics) {
    opts.metrics.firmNamesUsed++;
    opts.metrics.searchQueriesBuilt += buildFirmWebsiteSearchQueries(seed).length;
  }

  const found = await discoverWebsiteOsint(doc, {
    metrics: opts?.metrics,
    trace: opts?.trace,
  });
  return mapOsintToLadder(found);
}

export type { EnrichmentSourceType };
