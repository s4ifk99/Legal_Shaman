/**
 * List weak SRA providers and enrichment gaps.
 * Usage: npm run providers:weak [--limit=50]
 */
import "./load-dotenv";

import { analyzeWeakProviders } from "@/lib/provider-enrichment-ladder/weak-provider-detector";
import { loadEnrichmentMap, loadSraIndexDocuments } from "@/lib/provider-enrichment-ladder/ladder-cli";

async function main() {
  const docs = await loadSraIndexDocuments();
  const enrichmentMap = await loadEnrichmentMap();
  const report = analyzeWeakProviders(docs, enrichmentMap, { sraOnly: true, topN: 25 });

  console.info(
    JSON.stringify(
      {
        event: "providers_weak",
        totalScanned: report.totalScanned,
        totalWeak: report.totalWeak,
        weakPct: report.totalScanned
          ? Math.round((report.totalWeak / report.totalScanned) * 1000) / 10
          : 0,
        weakBySource: report.weakBySource,
        weakByReason: report.weakByReason,
        weakByPracticeArea: report.weakByPracticeArea,
        topPriority: report.topPriority.map((w) => ({
          id: w.doc.id,
          title: w.doc.title,
          city: w.doc.city,
          priorityScore: w.priorityScore,
          reasons: w.reasons,
        })),
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
