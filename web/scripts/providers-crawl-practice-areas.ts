import "./load-dotenv";

import {
  parsePracticeAreaCliOptions,
  runPracticeAreaBatch,
} from "@/lib/provider-intelligence-crawler-v2/practice-area-batch";

async function main() {
  const opts = parsePracticeAreaCliOptions(process.argv);
  const result = await runPracticeAreaBatch(opts);
  console.info(JSON.stringify({ event: "providers_crawl_practice_areas", ...result }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
