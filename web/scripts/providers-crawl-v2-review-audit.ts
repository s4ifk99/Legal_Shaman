import "./load-dotenv";

import {
  loadV2CrawlReview,
  v2CrawlReviewExitCode,
} from "@/lib/provider-intelligence-crawler-v2/crawl-v2-review";

async function main() {
  const output = await loadV2CrawlReview({ audit: true });
  console.info(JSON.stringify(output, null, 2));
  process.exitCode = v2CrawlReviewExitCode(output);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
