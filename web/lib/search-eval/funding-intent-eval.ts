import { detectFundingIntent } from "@/lib/legal-search/funding-intent";
import { ruleBasedParse } from "@/lib/legal-search/query-rules";
import { applySourceDiversity } from "@/lib/legal-search/source-diversity";
import { emptyScores } from "@/lib/legal-search/ranking";
import type { SearchResult } from "@/lib/legal-search/types";

function mockHit(
  id: string,
  source: SearchResult["source"],
  entityType: string,
  final: number,
): SearchResult {
  return {
    id,
    source,
    title: `Test ${id}`,
    practiceAreas: ["Family"],
    categories: [],
    raw: { entityType },
    scores: emptyScores({ final }),
    explanation: "",
  };
}

export function runFundingIntentEval(): number {
  let failed = 0;
  const fail = (msg: string) => {
    console.error(`FAIL funding-intent: ${msg}`);
    failed++;
  };

  if (detectFundingIntent("need a good divorce lawyer") !== "private_or_unspecified") {
    fail("generic divorce lawyer should be private_or_unspecified");
  }
  if (detectFundingIntent("need legal aid divorce lawyer") !== "legal_aid") {
    fail("legal aid divorce should be legal_aid");
  }
  if (detectFundingIntent("free family lawyer") !== "free_help") {
    fail("free family lawyer should be free_help");
  }
  if (detectFundingIntent("private divorce solicitor Manchester") !== "private") {
    fail("private divorce Manchester should be private");
  }

  const parsed = ruleBasedParse("need a good divorce lawyer");
  if (parsed.fundingIntent !== "private_or_unspecified") {
    fail(`ruleBasedParse fundingIntent ${parsed.fundingIntent}`);
  }
  if (parsed.legalAidSignal) {
    fail("generic lawyer parse must not set legalAidSignal");
  }

  const sorted = [
    mockHit("la1", "legal_aid", "legal_aid_provider", 0.95),
    mockHit("la2", "legal_aid", "legal_aid_provider", 0.94),
    mockHit("la3", "legal_aid", "legal_aid_provider", 0.93),
    mockHit("la4", "legal_aid", "legal_aid_provider", 0.92),
    mockHit("la5", "legal_aid", "legal_aid_provider", 0.91),
    mockHit("sra1", "sra", "sra_organisation", 0.85),
    mockHit("cur1", "curated_listing", "curated_listing", 0.84),
    mockHit("lw1", "lawyer", "lawyer", 0.83),
    mockHit("fm1", "firm", "firm", 0.82),
  ];
  const { results: diversified } = applySourceDiversity(sorted, "private_or_unspecified", {
    topK: 5,
  });
  const top5 = diversified.slice(0, 5);
  const laInTop = top5.filter((r) => r.source === "legal_aid").length;
  const hasPrivate = top5.some(
    (r) => r.source === "sra" || r.source === "curated_listing" || r.source === "lawyer" || r.source === "firm",
  );
  if (laInTop > 2) {
    fail(`diversity cap: ${laInTop} legal_aid in top 5 (max 2)`);
  }
  if (!hasPrivate) {
    fail("diversity should surface private/SRA/curated in top 5 when available");
  }

  if (failed === 0) console.info("funding-intent eval OK");
  return failed;
}
