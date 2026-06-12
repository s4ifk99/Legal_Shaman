import { fetchCrawlPage } from "@/lib/provider-crawler/fetcher";
import { runLadderForProvider } from "@/lib/provider-enrichment-ladder/extraction-runner";
import {
  discoverPracticePageUrls,
  extractPracticeAreaCandidates,
  slugsFromPageUrl,
} from "@/lib/provider-enrichment-ladder/practice-page-discovery";
import type { LegalEntityDocument } from "@/lib/search-index/types";
import type { ProviderEnrichment } from "@/lib/provider-enrichment/types";
import { approveAndPersistV2Candidate } from "@/lib/provider-intelligence-crawler-v2/persist";
import { computeV2Confidence } from "@/lib/provider-intelligence-crawler-v2/confidence";
import {
  gatePracticeAreaSlug,
} from "@/lib/provider-intelligence-crawler-v2/practice-area-taxonomy-gate";
import { slugLabel } from "@/lib/provider-crawler/practice-area-normalizer";
import type {
  CrawlerV2RunStats,
  PracticeAreaDebugRow,
  PracticeAreaExtractionResult,
  V2ExtractionCandidate,
} from "@/lib/provider-intelligence-crawler-v2/types";
import type { WebsiteResolution } from "@/lib/provider-intelligence-crawler-v2/website-resolution";

const PAGE_TIMEOUT_MS = Number(process.env.PROVIDER_LADDER_PAGE_TIMEOUT_MS ?? "12000");
const MAX_PAGES = Number(process.env.PROVIDER_LADDER_MAX_PAGES ?? "5");

async function fetchPageSafe(
  url: string,
  officialWebsite?: string,
): Promise<{ url: string; text: string; html: string } | null> {
  try {
    const result = await Promise.race([
      fetchCrawlPage(url, { officialWebsite }),
      new Promise<{ ok: false; reason: string }>((resolve) =>
        setTimeout(() => resolve({ ok: false, reason: "timeout" }), PAGE_TIMEOUT_MS),
      ),
    ]);
    if (!result.ok) return null;
    const page = result.page;
    return { url: page.url, text: page.text, html: page.html };
  } catch {
    return null;
  }
}

async function persistPracticeCandidate(
  crawlRunId: string,
  c: V2ExtractionCandidate,
  stats: CrawlerV2RunStats,
): Promise<void> {
  const gate = gatePracticeAreaSlug(c.practiceSlug ?? c.extractedValue);
  if (!gate.allowed) {
    stats.rejected++;
    return;
  }

  const candidate: V2ExtractionCandidate = {
    ...c,
    extractedValue: gate.slug,
    practiceSlug: gate.slug,
    practiceLabel: gate.displayName,
    provenanceNote: `${c.provenanceNote ?? ""};taxonomy_gate=strict`.slice(0, 2000),
  };

  stats.candidatesSubmitted++;
  const { approval } = await approveAndPersistV2Candidate(crawlRunId, candidate);
  if (approval.status === "auto_approved") stats.autoApproved++;
  else if (approval.status === "rejected") stats.rejected++;
  else stats.pendingReview++;
}

export async function runPracticeAreaExtractionEngine(
  doc: LegalEntityDocument,
  enrichments: ProviderEnrichment[],
  crawlRunId: string,
  resolution?: WebsiteResolution,
): Promise<PracticeAreaExtractionResult> {
  const stats: PracticeAreaExtractionResult = {
    candidatesSubmitted: 0,
    autoApproved: 0,
    pendingReview: 0,
    rejected: 0,
    errors: [],
    pagesFetched: 0,
    servicePagesDetected: 0,
    taxonomyMatches: 0,
    approvedWebsite: resolution?.approvedWebsite,
    pendingWebsite: resolution?.pendingWebsite,
    skipReason: resolution?.skipReason,
  };

  const website = resolution?.websiteForExtraction;
  if (!website) {
    stats.skipReason = resolution?.skipReason ?? "no_approved_website";
    return stats;
  }

  const slugKeys = new Set<string>();
  const home = await fetchPageSafe(website, website);
  if (home) {
    stats.pagesFetched++;
    for (const hit of slugsFromPageUrl(home.url)) {
      slugKeys.add(hit.slug);
      stats.taxonomyMatches++;
      const c: V2ExtractionCandidate = {
        entityId: doc.id,
        entityType: doc.entityType,
        fieldName: "practiceAreaSlugs",
        extractedValue: hit.slug,
        practiceLabel: slugLabel(hit.slug),
        practiceSlug: hit.slug,
        confidence: computeV2Confidence({
          sourceType: "provider_website",
          rawConfidence: hit.confidence,
          officialPage: true,
        }),
        sourceType: "provider_website",
        sourceUrl: home.url,
        extractionMethod: "html_parse",
        provenanceNote: hit.signal,
      };
      await persistPracticeCandidate(crawlRunId, c, stats);
    }

    const serviceUrls = discoverPracticePageUrls(website, home.html);
    stats.servicePagesDetected += serviceUrls.length;
    for (const pageUrl of serviceUrls.slice(0, MAX_PAGES)) {
      const page = await fetchPageSafe(pageUrl, website);
      if (!page) continue;
      stats.pagesFetched++;
      for (const hit of slugsFromPageUrl(page.url)) {
        if (slugKeys.has(hit.slug)) continue;
        slugKeys.add(hit.slug);
        stats.taxonomyMatches++;
        const c: V2ExtractionCandidate = {
          entityId: doc.id,
          entityType: doc.entityType,
          fieldName: "practiceAreaSlugs",
          extractedValue: hit.slug,
          practiceLabel: slugLabel(hit.slug),
          practiceSlug: hit.slug,
          confidence: computeV2Confidence({
            sourceType: "provider_website",
            rawConfidence: hit.confidence,
            officialPage: true,
          }),
          sourceType: "provider_website",
          sourceUrl: page.url,
          extractionMethod: "html_parse",
          provenanceNote: hit.signal,
        };
        await persistPracticeCandidate(crawlRunId, c, stats);
      }

      for (const legacy of extractPracticeAreaCandidates(page.text, page.html, page.url, {
        entityId: doc.id,
        entityType: doc.entityType,
      })) {
        const slugs = legacy.extractedValue.split(",").map((s) => s.trim()).filter(Boolean);
        for (const slug of slugs) {
          const gate = gatePracticeAreaSlug(slug);
          if (!gate.allowed || slugKeys.has(gate.slug)) continue;
          slugKeys.add(gate.slug);
          stats.taxonomyMatches++;
          const c: V2ExtractionCandidate = {
            entityId: doc.id,
            entityType: doc.entityType,
            fieldName: "practiceAreaSlugs",
            extractedValue: gate.slug,
            practiceLabel: gate.displayName,
            practiceSlug: gate.slug,
            confidence: computeV2Confidence({
              sourceType: "provider_website",
              rawConfidence: legacy.confidence,
              officialPage: true,
            }),
            sourceType: "provider_website",
            sourceUrl: page.url,
            extractionMethod: legacy.extractionMethod,
            provenanceNote: legacy.provenanceNote,
          };
          await persistPracticeCandidate(crawlRunId, c, stats);
        }
      }
    }
  } else {
    stats.errors.push("homepage_fetch_failed");
  }

  try {
    const ladderDoc: LegalEntityDocument = { ...doc, website };
    const ladder = await runLadderForProvider(ladderDoc, enrichments, "extract_practice_areas");
    stats.pendingReview += ladder.pendingReview;
    stats.candidatesSubmitted += ladder.candidatesSubmitted;
    stats.pagesFetched += Math.min(MAX_PAGES, 1);
  } catch (e) {
    stats.errors.push(`ladder: ${e instanceof Error ? e.message : String(e)}`);
  }

  return stats;
}

export function practiceAreaDebugRow(
  entityId: string,
  resolution: WebsiteResolution,
  stats: PracticeAreaExtractionResult,
): PracticeAreaDebugRow {
  return {
    providerId: entityId,
    approvedWebsite: resolution.approvedWebsite ?? null,
    pendingWebsite: resolution.pendingWebsite ?? null,
    skipReason: stats.skipReason ?? resolution.skipReason ?? null,
    pagesFetched: stats.pagesFetched,
    matches: stats.taxonomyMatches,
  };
}
