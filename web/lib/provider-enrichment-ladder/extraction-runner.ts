import { fetchCrawlPage } from "@/lib/provider-crawler/fetcher";
import { extractCapabilityFieldsFromText } from "@/lib/provider-crawler/extract-capabilities";
import {
  contactPageCandidate,
  extractContactFieldsFromText,
} from "@/lib/provider-crawler/extract-contact";
import { extractWebsiteFromText } from "@/lib/provider-enrichment/contact-extractor";
import { isRegulatoryOrDirectoryUrl } from "@/lib/provider-enrichment/regulatory-url-filter";
import { persistExtractedField } from "@/lib/provider-crawler/review-queue";
import type { LegalEntityDocument } from "@/lib/search-index/types";
import { buildEnrichmentPlan } from "@/lib/provider-enrichment-ladder/enrichment-planner";
import { runOsintEnrichment } from "@/lib/provider-osint/osint-runner";
import {
  discoverContactPageUrls,
  pickBestContactPage,
} from "@/lib/provider-enrichment-ladder/contact-page-discovery";
import {
  discoverPracticePageUrls,
  extractPracticeAreaCandidates,
} from "@/lib/provider-enrichment-ladder/practice-page-discovery";
import { validateExtractedField } from "@/lib/provider-enrichment-ladder/enrichment-validator";
import {
  nextStatusAfterContactExtraction,
  nextStatusAfterPracticeExtraction,
  nextStatusAfterWebsiteDiscovery,
} from "@/lib/provider-enrichment-ladder/enrichment-state";
import { upsertEnrichmentState, getEnrichmentState } from "@/lib/provider-enrichment-ladder/enrichment-state-store";
import type { LadderExtractionStats } from "@/lib/provider-enrichment-ladder/types";
import type { ProviderEnrichment } from "@/lib/provider-enrichment/types";

const MAX_PAGES_PER_PROVIDER = Number(process.env.PROVIDER_LADDER_MAX_PAGES ?? "5");
const PAGE_TIMEOUT_MS = Number(process.env.PROVIDER_LADDER_PAGE_TIMEOUT_MS ?? "12000");

export type LadderRunMode =
  | "full"
  | "discover_website"
  | "extract_contacts"
  | "extract_practice_areas";

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

export async function runLadderForProvider(
  doc: LegalEntityDocument,
  enrichments: ProviderEnrichment[] = [],
  mode: LadderRunMode = "full",
): Promise<LadderExtractionStats> {
  const stats: LadderExtractionStats = {
    entityId: doc.id,
    status: "not_started",
    candidatesSubmitted: 0,
    pendingReview: 0,
    autoApproved: 0,
    rejected: 0,
    errors: [],
  };

  const plan = buildEnrichmentPlan(doc, enrichments);
  if (!plan) {
    stats.status = "approved";
    await upsertEnrichmentState({
      entityId: doc.id,
      entityType: doc.entityType,
      status: "approved",
      priorityScore: 0,
    });
    return stats;
  }

  const existing = await getEnrichmentState(doc.id);
  let status = existing?.status ?? "planned";
  await upsertEnrichmentState({
    entityId: doc.id,
    entityType: doc.entityType,
    status: "planned",
    priorityScore: plan.priorityScore,
  });

  let website: string | null | undefined =
    doc.website ??
    existing?.discoveredWebsite ??
    extractWebsiteFromText(doc.searchText ?? "");

  if (website && isRegulatoryOrDirectoryUrl(website)) {
    website = null;
  }

  if (mode === "full" || mode === "discover_website") {
    const osint = await runOsintEnrichment(doc, enrichments, stats, {
      discoverWebsite: plan.missingFields.includes("website"),
      extractStructured: true,
    });
    if (osint.website) {
      website = osint.website;
      status = nextStatusAfterWebsiteDiscovery(status);
      await upsertEnrichmentState({
        entityId: doc.id,
        entityType: doc.entityType,
        status,
        discoveredWebsite: website,
        priorityScore: plan.priorityScore,
      });
    }
  } else if (mode === "extract_contacts" || mode === "extract_practice_areas") {
    await runOsintEnrichment(doc, enrichments, stats, {
      discoverWebsite: false,
      extractStructured: true,
    });
  }

  if (mode === "discover_website") {
    const nextStatus = website ? nextStatusAfterWebsiteDiscovery(status) : status;
    stats.status = nextStatus;
    await upsertEnrichmentState({
      entityId: doc.id,
      entityType: doc.entityType,
      status: nextStatus,
      discoveredWebsite: website ?? null,
      priorityScore: plan.priorityScore,
    });
    return stats;
  }

  if (!website && (mode === "extract_contacts" || mode === "extract_practice_areas" || mode === "full")) {
    stats.status = status;
    stats.errors.push("no_website_for_crawl");
    await upsertEnrichmentState({
      entityId: doc.id,
      entityType: doc.entityType,
      status: "retry_later",
      lastError: "no_website_for_crawl",
      priorityScore: plan.priorityScore,
      incrementAttempts: true,
    });
    return stats;
  }

  const officialWebsite = website?.startsWith("http") ? website : website ? `https://${website}` : undefined;
  let pagesFetched = 0;
  const visited = new Set<string>();

  const queue: string[] = [];
  if (officialWebsite) queue.push(officialWebsite);

  if (mode === "full" || mode === "extract_contacts" || mode === "extract_practice_areas") {
    const home = officialWebsite ? await fetchPageSafe(officialWebsite, officialWebsite) : null;
    if (home) {
      pagesFetched++;
      visited.add(home.url);

      if (mode !== "extract_practice_areas") {
        const contactUrls = discoverContactPageUrls(home.url, home.html);
        const bestContact = pickBestContactPage(contactUrls);
        if (bestContact && !visited.has(bestContact)) {
          queue.push(bestContact);
        }
      }

      if (mode !== "extract_contacts") {
        for (const u of discoverPracticePageUrls(home.url, home.html)) {
          if (!visited.has(u)) queue.push(u);
        }
      }

      if (mode !== "extract_practice_areas") {
        const caps = extractCapabilityFieldsFromText(home.text, {
          entityId: doc.id,
          entityType: doc.entityType,
          sourceUrl: home.url,
          sourceType: "provider_website",
          practiceAreas: doc.practiceAreas,
          legalAid: doc.legalAid,
        });
        for (const c of caps) {
          await persistCandidate(c, stats);
        }
        const contacts = extractContactFieldsFromText(home.text, {
          entityId: doc.id,
          entityType: doc.entityType,
          sourceUrl: home.url,
          sourceType: "provider_website",
          officialPage: true,
        });
        for (const c of contacts) {
          await persistCandidate(c, stats);
        }
      }

      if (mode !== "extract_contacts") {
        const practice = extractPracticeAreaCandidates(home.text, home.html, home.url, {
          entityId: doc.id,
          entityType: doc.entityType,
        });
        for (const c of practice) {
          await persistCandidate(c, stats);
        }
      }
    }
  }

  while (queue.length && pagesFetched < MAX_PAGES_PER_PROVIDER) {
    const url = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);

    const page = await fetchPageSafe(url, officialWebsite);
    if (!page) continue;
    pagesFetched++;

    if (mode !== "extract_practice_areas") {
      const contacts = extractContactFieldsFromText(page.text, {
        entityId: doc.id,
        entityType: doc.entityType,
        sourceUrl: page.url,
        sourceType: "provider_website",
        officialPage: true,
      });
      for (const c of contacts) {
        await persistCandidate(c, stats);
      }
      const contactUrls = discoverContactPageUrls(page.url, page.html);
      const best = pickBestContactPage(contactUrls);
      if (best) {
        const cp = contactPageCandidate(best, {
          entityId: doc.id,
          entityType: doc.entityType,
          sourceType: "provider_website",
        });
        await persistCandidate(cp, stats);
      }
    }

    if (mode !== "extract_contacts") {
      const practice = extractPracticeAreaCandidates(page.text, page.html, page.url, {
        entityId: doc.id,
        entityType: doc.entityType,
      });
      for (const c of practice) {
        await persistCandidate(c, stats);
      }
    }
  }

  if (stats.candidatesSubmitted > 0) {
    status =
      mode === "extract_practice_areas"
        ? nextStatusAfterPracticeExtraction(status)
        : nextStatusAfterContactExtraction(status);
    if (stats.pendingReview > 0) status = "pending_review";
  }

  stats.status = status;
  await upsertEnrichmentState({
    entityId: doc.id,
    entityType: doc.entityType,
    status,
    discoveredWebsite: website ?? null,
    priorityScore: plan.priorityScore,
  });

  return stats;
}

async function persistCandidate(
  c: Parameters<typeof persistExtractedField>[0],
  stats: LadderExtractionStats,
): Promise<void> {
  const valid = validateExtractedField(c);
  if (!valid.valid) {
    stats.rejected++;
    return;
  }
  const res = await persistExtractedField(c);
  stats.candidatesSubmitted++;
  if (res.status === "pending_review") stats.pendingReview++;
  else if (res.status === "auto_approved") stats.autoApproved++;
  else stats.rejected++;
}
