/**
 * Provider Intelligence Crawler v2 — unified CLI.
 * Usage: tsx scripts/providers-crawler-v2.ts <stage> [--limit=N] [--queue]
 */
import "./load-dotenv";

import { runCrawlerV2Batch } from "@/lib/provider-intelligence-crawler-v2/orchestrator";
import { CRAWLER_V2_STAGES, type CrawlerV2Stage } from "@/lib/provider-intelligence-crawler-v2/types";

const stageArg = process.argv[2]?.trim();
const processQueue = process.argv.includes("--queue");

function parseLimit(): number | undefined {
  const flag = process.argv.find((a) => a.startsWith("--limit="));
  if (!flag) return undefined;
  const n = Number(flag.split("=")[1]);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function missingFieldForStage(
  stage: CrawlerV2Stage,
): "website" | "phone" | "email" | "practiceAreaSlugs" | undefined {
  switch (stage) {
    case "discover_website":
      return "website";
    case "extract_contacts":
      return "phone";
    case "extract_practice_areas":
      return "practiceAreaSlugs";
    default:
      return undefined;
  }
}

async function main() {
  if (!stageArg || !CRAWLER_V2_STAGES.includes(stageArg as CrawlerV2Stage)) {
    console.error(`Usage: tsx scripts/providers-crawler-v2.ts <${CRAWLER_V2_STAGES.join("|")}> [--limit=N] [--queue]`);
    process.exit(1);
  }

  const stage = stageArg as CrawlerV2Stage;
  const result = await runCrawlerV2Batch({
    stage,
    limit: parseLimit(),
    missingField: missingFieldForStage(stage),
    processQueue,
  });

  console.info(JSON.stringify({ event: "provider_intelligence_crawler_v2", ...result }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
