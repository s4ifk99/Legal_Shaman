import {
  formatFullCrawlReviewDatasourceError,
  resetCrawlReviewDatasourceWarnDedupe,
} from "@/lib/provider-crawler/crawl-review-log";
import { computeV2CrawlReviewHealth } from "@/lib/provider-intelligence-crawler-v2/crawl-v2-review";
import { v2ReviewQueryTimeoutError } from "@/lib/provider-intelligence-crawler-v2/crawl-v2-review-datasource";
import { Prisma } from "@prisma/client";

export function runCrawlV2ReviewEval(): number {
  let failed = 0;
  const fail = (msg: string) => {
    console.error(`FAIL crawl-v2-review: ${msg}`);
    failed++;
  };

  const healthyOptionalDown = computeV2CrawlReviewHealth({
    enrichmentsOk: true,
    optionalSourcesOk: [false, false, true, true],
  });
  if (!healthyOptionalDown.ok) {
    fail("review should stay ok when enrichments healthy but optional v2 tables fail");
  }
  if (!healthyOptionalDown.degraded) {
    fail("review should be degraded when optional sources fail");
  }

  const enrichmentsDown = computeV2CrawlReviewHealth({
    enrichmentsOk: false,
    optionalSourcesOk: [true, true, true, true],
  });
  if (enrichmentsDown.ok) {
    fail("review must not be ok when enrichments unavailable");
  }
  if (!enrichmentsDown.degraded) {
    fail("review must be degraded when enrichments unavailable");
  }

  const allOk = computeV2CrawlReviewHealth({
    enrichmentsOk: true,
    optionalSourcesOk: [true, true, true, true],
  });
  if (!allOk.ok || allOk.degraded) {
    fail("fully healthy review should be ok and not degraded");
  }

  const timeoutErr = v2ReviewQueryTimeoutError(100);
  if ((timeoutErr as { code?: string }).code !== "ETIMEDOUT") {
    fail("timeout error should include ETIMEDOUT code");
  }

  const fakePrisma = new Prisma.PrismaClientKnownRequestError("full message line one\nfull message line two", {
    code: "P2010",
    clientVersion: "test",
  });
  const formatted = formatFullCrawlReviewDatasourceError(fakePrisma);
  if (!formatted.includes("full message line two")) {
    fail("full error formatter must not truncate multi-line Prisma messages");
  }

  resetCrawlReviewDatasourceWarnDedupe();

  if (failed === 0) {
    console.info("PASS crawl-v2-review eval (partial datasource degradation)");
  }
  return failed;
}
