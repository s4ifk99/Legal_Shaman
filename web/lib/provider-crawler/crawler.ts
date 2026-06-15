import { prisma } from "@/lib/db/prisma";
import type { LegalEntityDocument } from "@/lib/search-index/types";
import { extractCapabilityFieldsFromText } from "@/lib/provider-crawler/extract-capabilities";
import { extractContactFieldsFromText, contactPageCandidate } from "@/lib/provider-crawler/extract-contact";
import { extractTestimonialSnippets } from "@/lib/provider-crawler/extract-testimonials";
import {
  fetchCrawlPage,
  findContactPageLinks,
  isAllowedCrawlUrl,
} from "@/lib/provider-crawler/fetcher";
import { persistExtractedField } from "@/lib/provider-crawler/review-queue";
import {
  fetchTrustpilotAggregate,
  trustpilotFieldsFromStructured,
  TRUSTPILOT_SCRAPE_ENABLED,
} from "@/lib/provider-crawler/trustpilot-api";
import type { CrawlMode, CrawlRunStats, CrawlSourceType, ExtractedFieldCandidate } from "@/lib/provider-crawler/types";

function sourceTypeForDoc(doc: LegalEntityDocument): CrawlSourceType {
  if (doc.legalAid || doc.entityType === "legal_aid_provider") return "govuk_legal_aid";
  if (doc.entityType === "sra_organisation") return "sra_register";
  if (doc.source === "curated" || doc.entityType.includes("law_centre")) return "curated_source";
  if (doc.profileUrl && /lawsociety\.org\.uk/i.test(doc.profileUrl)) return "law_society";
  return "provider_website";
}

function structuredContactFields(doc: LegalEntityDocument): ExtractedFieldCandidate[] {
  const sourceType = "structured_db" as const;
  const extractedAt = new Date();
  const out: ExtractedFieldCandidate[] = [];

  if (doc.phone) {
    out.push({
      entityId: doc.id,
      entityType: doc.entityType,
      fieldName: "phone",
      extractedValue: doc.phone,
      confidence: 0.95,
      sourceType,
      extractionMethod: "structured_field",
      extractedAt,
    });
  }
  if (doc.email) {
    out.push({
      entityId: doc.id,
      entityType: doc.entityType,
      fieldName: "email",
      extractedValue: doc.email,
      confidence: 0.95,
      sourceType,
      extractionMethod: "structured_field",
      extractedAt,
    });
  }
  if (doc.website) {
    out.push({
      entityId: doc.id,
      entityType: doc.entityType,
      fieldName: "website",
      extractedValue: doc.website,
      confidence: 0.95,
      sourceType,
      extractionMethod: "structured_field",
      extractedAt,
    });
  }
  if (doc.address) {
    out.push({
      entityId: doc.id,
      entityType: doc.entityType,
      fieldName: "address",
      extractedValue: doc.address,
      confidence: 0.9,
      sourceType,
      extractionMethod: "structured_field",
      extractedAt,
    });
  }

  return out;
}

async function persistCandidates(
  candidates: ExtractedFieldCandidate[],
  crawlResultId: string,
  stats: CrawlRunStats,
): Promise<void> {
  for (const c of candidates) {
    const res = await persistExtractedField(c, crawlResultId);
    stats.fieldsFound++;
    if (res.status === "auto_approved") stats.autoApproved++;
    else if (res.status === "pending_review") stats.pendingReview++;
    else if (res.status === "rejected") stats.rejected++;
    if (res.reason) stats.errors.push(res.reason);
  }
}

/**
 * Run a compliant enrichment crawl for one provider document.
 */
export async function crawlProviderDocument(
  doc: LegalEntityDocument,
  mode: CrawlMode,
  opts?: { jobId?: string },
): Promise<CrawlRunStats> {
  const stats: CrawlRunStats = {
    pagesFetched: 0,
    pagesSkipped: 0,
    fieldsFound: 0,
    pendingReview: 0,
    autoApproved: 0,
    rejected: 0,
    errors: [],
  };

  const sourceType = sourceTypeForDoc(doc);
  const website = doc.website ?? doc.profileUrl;
  let crawlResultId: string | undefined;

  if (opts?.jobId) {
    try {
      const result = await prisma.providerCrawlResult.create({
        data: { jobId: opts.jobId, entityId: doc.id },
      });
      crawlResultId = result.id;
      await prisma.providerCrawlJob.update({
        where: { id: opts.jobId },
        data: { status: "running", startedAt: new Date() },
      });
    } catch {
      /* continue without job linkage */
    }
  }

  const structured = structuredContactFields(doc);
  if (mode === "contacts" || mode === "all") {
    await persistCandidates(structured, crawlResultId ?? "", stats);
  }

  const baseText = `${doc.title}\n${doc.description}\n${doc.searchText}`;

  if (mode === "capabilities" || mode === "all") {
    const caps = extractCapabilityFieldsFromText(baseText, {
      entityId: doc.id,
      entityType: doc.entityType,
      sourceType,
      practiceAreas: doc.practiceAreas,
      legalAid: doc.legalAid,
    });
    await persistCandidates(caps, crawlResultId ?? "", stats);
  }

  if (mode === "trustpilot" || mode === "all") {
    const structuredTp = trustpilotFieldsFromStructured({
      entityId: doc.id,
      entityType: doc.entityType,
      rating: doc.rating,
      reviewCount: doc.reviewCount,
    });
    await persistCandidates(structuredTp, crawlResultId ?? "", stats);

    const unitId = process.env.TRUSTPILOT_BUSINESS_UNIT_ID;
    if (unitId) {
      const apiFields = await fetchTrustpilotAggregate(unitId, {
        entityId: doc.id,
        entityType: doc.entityType,
      });
      await persistCandidates(apiFields, crawlResultId ?? "", stats);
    }

    if (website && /trustpilot\.com/i.test(website) && !TRUSTPILOT_SCRAPE_ENABLED) {
      stats.pagesSkipped++;
      stats.errors.push("trustpilot_scrape_disabled");
    }
  }

  if (mode === "testimonials" || mode === "all") {
    /* testimonials extracted from fetched pages below */
  }

  const shouldFetch =
    mode === "contacts" ||
    mode === "all" ||
    mode === "testimonials" ||
    (mode === "capabilities" && Boolean(website));

  if (shouldFetch && website?.startsWith("http")) {
    const allow = isAllowedCrawlUrl(website, { officialWebsite: doc.website });
    if (!allow.allowed) {
      stats.pagesSkipped++;
      if (allow.reason) stats.errors.push(allow.reason);
    } else {
      const main = await fetchCrawlPage(website, { officialWebsite: doc.website });
      if (main.ok) {
        stats.pagesFetched++;
        const page = main.page;

        if (mode === "contacts" || mode === "all") {
          const contacts = extractContactFieldsFromText(page.text, {
            entityId: doc.id,
            entityType: doc.entityType,
            sourceUrl: page.url,
            sourceType: "provider_website",
            officialPage: true,
          });
          await persistCandidates(contacts, crawlResultId ?? "", stats);

          const contactLinks = findContactPageLinks(page.html, page.url);
          for (const link of contactLinks) {
            const sub = await fetchCrawlPage(link, { officialWebsite: doc.website });
            if (!sub.ok) {
              stats.pagesSkipped++;
              continue;
            }
            stats.pagesFetched++;
            await persistCandidates(
              [
                contactPageCandidate(link, {
                  entityId: doc.id,
                  entityType: doc.entityType,
                  sourceType: "provider_website",
                }),
                ...extractContactFieldsFromText(sub.page.text, {
                  entityId: doc.id,
                  entityType: doc.entityType,
                  sourceUrl: sub.page.url,
                  sourceType: "provider_website",
                  officialPage: true,
                }),
              ],
              crawlResultId ?? "",
              stats,
            );
          }
        }

        if (mode === "capabilities" || mode === "all") {
          const caps = extractCapabilityFieldsFromText(page.text, {
            entityId: doc.id,
            entityType: doc.entityType,
            sourceUrl: page.url,
            sourceType: "provider_website",
            practiceAreas: doc.practiceAreas,
            legalAid: doc.legalAid,
          });
          await persistCandidates(caps, crawlResultId ?? "", stats);
        }

        if (mode === "testimonials" || mode === "all") {
          const snippets = extractTestimonialSnippets(page.html, {
            entityId: doc.id,
            entityType: doc.entityType,
            sourceUrl: page.url,
            sourceType: "provider_website",
          });
          await persistCandidates(snippets, crawlResultId ?? "", stats);
        }
      } else {
        stats.pagesSkipped++;
        if (main.reason) stats.errors.push(main.reason);
      }
    }
  }

  if (opts?.jobId && crawlResultId) {
    try {
      await prisma.providerCrawlResult.update({
        where: { id: crawlResultId },
        data: {
          pagesFetched: stats.pagesFetched,
          pagesSkipped: stats.pagesSkipped,
          fieldsFound: stats.fieldsFound,
          statsJson: JSON.stringify(stats),
        },
      });
      await prisma.providerCrawlJob.update({
        where: { id: opts.jobId },
        data: {
          status: "completed",
          completedAt: new Date(),
          targetUrl: website ?? undefined,
        },
      });
    } catch {
      /* ignore */
    }
  }

  return stats;
}

export async function runQueuedCrawlJobs(limit = 20): Promise<{ processed: number; errors: string[] }> {
  const jobs = await prisma.providerCrawlJob.findMany({
    where: { status: "queued" },
    orderBy: { scheduledAt: "asc" },
    take: limit,
  });

  const errors: string[] = [];
  let processed = 0;

  for (const job of jobs) {
    processed++;
    try {
      await prisma.providerCrawlJob.update({
        where: { id: job.id },
        data: { status: "skipped", error: "run via providers:crawl with document context" },
      });
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  return { processed, errors };
}
