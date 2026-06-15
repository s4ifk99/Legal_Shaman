import { runLadderForProvider } from "@/lib/provider-enrichment-ladder/extraction-runner";
import type { LegalEntityDocument } from "@/lib/search-index/types";
import type { ProviderEnrichment } from "@/lib/provider-enrichment/types";
import { approveAndPersistV2Candidate } from "@/lib/provider-intelligence-crawler-v2/persist";
import { computeV2Confidence } from "@/lib/provider-intelligence-crawler-v2/confidence";
import { extractPhoneFromSraSearchText } from "@/lib/search/sra-display";
import type { CrawlerV2RunStats, V2ExtractionCandidate } from "@/lib/provider-intelligence-crawler-v2/types";

function sraRegisterPhoneCandidates(doc: LegalEntityDocument): V2ExtractionCandidate[] {
  const out: V2ExtractionCandidate[] = [];
  const phone = doc.phone?.trim();
  if (phone) {
    out.push({
      entityId: doc.id,
      entityType: doc.entityType,
      fieldName: "phone",
      extractedValue: phone,
      confidence: computeV2Confidence({
        sourceType: "sra_register",
        rawConfidence: 0.96,
        structuredField: true,
      }),
      sourceType: "sra_register",
      extractionMethod: "structured_field",
      provenanceNote: "sra_register_phone",
    });
  }

  const fromText = extractPhoneFromSraSearchText(doc.searchText ?? "");
  if (fromText && fromText !== phone) {
    out.push({
      entityId: doc.id,
      entityType: doc.entityType,
      fieldName: "phone",
      extractedValue: fromText,
      confidence: computeV2Confidence({
        sourceType: "sra_register",
        rawConfidence: 0.88,
      }),
      sourceType: "sra_register",
      extractionMethod: "structured_field",
      provenanceNote: "sra_search_text_phone",
    });
  }
  return out;
}

export async function runContactExtractionEngine(
  doc: LegalEntityDocument,
  enrichments: ProviderEnrichment[],
  crawlRunId: string,
): Promise<CrawlerV2RunStats> {
  const stats: CrawlerV2RunStats = {
    candidatesSubmitted: 0,
    autoApproved: 0,
    pendingReview: 0,
    rejected: 0,
    errors: [],
  };

  for (const c of sraRegisterPhoneCandidates(doc)) {
    stats.candidatesSubmitted++;
    try {
      const { approval } = await approveAndPersistV2Candidate(crawlRunId, c);
      if (approval.status === "auto_approved") stats.autoApproved++;
      else if (approval.status === "rejected") stats.rejected++;
      else stats.pendingReview++;
    } catch (e) {
      stats.errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  try {
    const ladder = await runLadderForProvider(doc, enrichments, "extract_contacts");
    stats.autoApproved += ladder.autoApproved;
    stats.pendingReview += ladder.pendingReview;
    stats.rejected += ladder.rejected;
    stats.candidatesSubmitted += ladder.candidatesSubmitted;
  } catch (e) {
    stats.errors.push(`ladder: ${e instanceof Error ? e.message : String(e)}`);
  }

  return stats;
}
