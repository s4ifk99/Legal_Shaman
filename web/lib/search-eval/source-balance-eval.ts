import { applySourceDiversity } from "@/lib/legal-search/source-diversity";
import { emptyScores } from "@/lib/legal-search/ranking";
import type { SearchResult } from "@/lib/legal-search/types";
import {
  assessPrivateCoverage,
  buildCoverageNotice,
  MISSING_PRIVATE_COVERAGE_NOTICE,
} from "@/lib/legal-search/private-coverage";

function mockLa(id: string, score: number): SearchResult {
  return {
    id,
    source: "legal_aid",
    title: `LA ${id}`,
    practiceAreas: ["Family"],
    categories: [],
    raw: { entityType: "legal_aid_provider" },
    scores: emptyScores({ final: score }),
    explanation: "Matches your search criteria.",
  };
}

function mockPrivate(id: string, score: number): SearchResult {
  return {
    id,
    source: "curated_listing",
    title: `Firm ${id}`,
    practiceAreas: ["Family"],
    categories: [],
    raw: { entityType: "curated_listing" },
    scores: emptyScores({ final: score }),
    explanation: "Matches your search criteria.",
  };
}

export function runSourceBalanceEval(): number {
  let failed = 0;
  const fail = (msg: string) => {
    console.error(`FAIL source-balance: ${msg}`);
    failed++;
  };

  const pool = [
    ...Array.from({ length: 8 }, (_, i) => mockLa(`la${i}`, 0.9 - i * 0.01)),
    ...Array.from({ length: 12 }, (_, i) => mockPrivate(`p${i}`, 0.55 - i * 0.02)),
  ];
  const { results, debug } = applySourceDiversity(pool, "private_or_unspecified", { topK: 10 });
  const top = results.slice(0, 10);
  const laCount = top.filter((r) => r.source === "legal_aid").length;
  if (laCount > 4) {
    fail(`generic diversity should cap legal_aid in top 10, got ${laCount}`);
  }
  if (!debug.sourceDiversityApplied && laCount > 4) {
    fail("diversity should apply when legal aid dominates");
  }

  const laOnly = Array.from({ length: 10 }, (_, i) => mockLa(`only${i}`, 0.9));
  const { debug: d2 } = applySourceDiversity(laOnly, "private_or_unspecified", { topK: 10 });
  if (d2.sourceDiversityApplied) {
    fail("should not fabricate diversity when only legal aid exists");
  }

  const coverage = assessPrivateCoverage({
    query: "need a good divorce lawyer",
    parsed: {
      rawText: "need a good divorce lawyer",
      semanticQuery: "need a good divorce lawyer",
      intent: "find_lawyer",
      fundingIntent: "private_or_unspecified",
    } as import("@/lib/legal-search/types").ParsedQuery,
    results: [mockLa("1", 0.8)],
    catalog: {
      totalDocuments: 4911,
      byEntityType: { legal_aid_provider: 4829 },
      bySource: { legal_aid: 4829 },
      byPracticeAreaSlug: { family: 100 },
      byFundingRoute: { legal_aid: 4829, private: 24, pro_bono: 58 },
      familyBySource: { legal_aid: 100 },
      familyPrivateFacingCount: 0,
      familySraCount: 0,
      familyDivorcePrivateCount: 0,
      legalAidOnlySlugCount: 1,
      sraByPracticeAreaSlug: { family: 0 },
      sraProjectionSamples: [],
      sraProjectionConfidenceRange: null,
      employmentProjectionSamples: [],
      employmentProjectionConfidenceRange: null,
    },
  });
  if (!coverage.showCoverageNotice) fail("should show coverage notice");
  if (buildCoverageNotice(coverage) !== MISSING_PRIVATE_COVERAGE_NOTICE) fail("notice text");

  if (failed === 0) console.info("source balance eval OK");
  return failed;
}
