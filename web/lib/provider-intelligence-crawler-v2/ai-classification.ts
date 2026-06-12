import { llmConfigured, chat } from "@/lib/llm/client";
import type { LegalEntityDocument } from "@/lib/search-index/types";
import type { ProviderEnrichment } from "@/lib/provider-enrichment/types";
import { approveAndPersistV2Candidate } from "@/lib/provider-intelligence-crawler-v2/persist";
import { computeV2Confidence } from "@/lib/provider-intelligence-crawler-v2/confidence";
import type { CrawlerV2RunStats, V2ExtractionCandidate } from "@/lib/provider-intelligence-crawler-v2/types";

type AiClassification = {
  practiceAreas?: { slug: string; label: string; confidence?: number }[];
  capabilities?: string[];
  summary?: string;
};

export async function classifyProviderWithOpenRouter(
  doc: LegalEntityDocument,
): Promise<AiClassification | null> {
  if (!llmConfigured()) return null;

  const snippet = [
    doc.title,
    doc.description,
    doc.searchText?.slice(0, 2000),
    doc.practiceAreas?.join(", "),
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 3500);

  const raw = await chat(
    [
      {
        role: "system",
        content:
          "You classify UK legal service providers. Return JSON only: { practiceAreas: [{slug,label,confidence}], capabilities: string[], summary: string }. Use UK English practice slugs like employment, family, immigration, housing, criminal, conveyancing, personal_injury. Never invent contact details.",
      },
      { role: "user", content: snippet },
    ],
    { jsonMode: true, temperature: 0.1, maxTokens: 500 },
  );

  try {
    return JSON.parse(raw) as AiClassification;
  } catch {
    return null;
  }
}

export async function runAiEnrichmentEngine(
  doc: LegalEntityDocument,
  _enrichments: ProviderEnrichment[],
  crawlRunId: string,
): Promise<CrawlerV2RunStats> {
  const stats: CrawlerV2RunStats = {
    candidatesSubmitted: 0,
    autoApproved: 0,
    pendingReview: 0,
    rejected: 0,
    errors: [],
  };

  const classified = await classifyProviderWithOpenRouter(doc);
  if (!classified?.practiceAreas?.length) {
    if (!llmConfigured()) stats.errors.push("llm_not_configured");
    return stats;
  }

  for (const cap of classified.capabilities?.slice(0, 8) ?? []) {
    if (!cap?.trim()) continue;
    const c: V2ExtractionCandidate = {
      entityId: doc.id,
      entityType: doc.entityType,
      fieldName: "capabilities",
      extractedValue: cap.trim(),
      confidence: computeV2Confidence({
        sourceType: "provider_website",
        rawConfidence: 0.7,
      }),
      sourceType: "provider_website",
      extractionMethod: "capability_patterns",
      provenanceNote: "openrouter_classify",
    };
    stats.candidatesSubmitted++;
    const { approval } = await approveAndPersistV2Candidate(crawlRunId, c);
    if (approval.status === "auto_approved") stats.autoApproved++;
    else if (approval.status === "rejected") stats.rejected++;
    else stats.pendingReview++;
  }

  for (const pa of classified.practiceAreas.slice(0, 12)) {
    if (!pa.slug || !pa.label) continue;
    const c: V2ExtractionCandidate = {
      entityId: doc.id,
      entityType: doc.entityType,
      fieldName: "practiceAreaSlugs",
      extractedValue: pa.slug,
      practiceLabel: pa.label,
      practiceSlug: pa.slug,
      confidence: computeV2Confidence({
        sourceType: "provider_website",
        rawConfidence: pa.confidence ?? 0.72,
      }),
      sourceType: "provider_website",
      extractionMethod: "html_parse",
      provenanceNote: classified.summary?.slice(0, 200),
    };
    stats.candidatesSubmitted++;
    const { approval } = await approveAndPersistV2Candidate(crawlRunId, c);
    if (approval.status === "auto_approved") stats.autoApproved++;
    else if (approval.status === "rejected") stats.rejected++;
    else stats.pendingReview++;
  }

  return stats;
}
