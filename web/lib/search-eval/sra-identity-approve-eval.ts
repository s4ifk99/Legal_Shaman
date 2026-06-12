import { rejectCandidateName } from "@/lib/sra/missing-identity-recovery/candidate-name-rejection";
import {
  kickOffIdentityApprovalCrawls,
  scheduleIdentityApprovalCrawls,
} from "@/lib/sra/missing-identity-recovery/identity-crawl-schedule";
import type { CrawlerV2Stage } from "@/lib/provider-intelligence-crawler-v2/types";

export async function runSraIdentityApproveEval(): Promise<number> {
  let failed = 0;
  const fail = (msg: string) => {
    console.error(`FAIL sra-identity-approve: ${msg}`);
    failed++;
  };

  const regulatory = rejectCandidateName(
    "Solicitors Regulation Authority decision tracker archive: 2025",
    {
      sourceType: "serper",
      sourceUrl: "https://www.sra.org.uk/news/archive/decision-tracker",
    },
  );
  if (!regulatory.rejected) {
    fail("regulatory/archive candidate title should be rejected");
  }

  const regulatoryUrl = rejectCandidateName("Example Firm LLP", {
    sourceType: "serper",
    sourceUrl: "https://www.lawsociety.org.uk/find-a-solicitor",
  });
  if (!regulatoryUrl.rejected) {
    fail("lawsociety.org.uk source URL should be rejected");
  }

  let crawlCalls = 0;
  const throwingSchedule = async () => {
    crawlCalls++;
    throw Object.assign(new Error("providerCrawlRun.create ETIMEDOUT"), { code: "ETIMEDOUT" });
  };

  const resilient = await scheduleIdentityApprovalCrawls("sra:1002231", "sra_organisation", {
    deps: { scheduleRun: throwingSchedule },
  });
  if (crawlCalls !== 3) {
    fail(`expected 3 crawl schedule attempts, got ${crawlCalls}`);
  }
  if (resilient.scheduled !== 0 || resilient.failed !== 3) {
    fail("all crawl schedule failures should be absorbed without throwing");
  }
  if (!resilient.failures.every((f) => f.code === "ETIMEDOUT")) {
    fail("crawl failure should record ETIMEDOUT code");
  }

  crawlCalls = 0;
  const skipped = await scheduleIdentityApprovalCrawls("sra:1002231", "sra_organisation", {
    skipCrawl: true,
    deps: {
      scheduleRun: async () => {
        crawlCalls++;
        return "run-id";
      },
    },
  });
  if (crawlCalls !== 0 || skipped.scheduled !== 0) {
    fail("--skip-crawl should not invoke scheduleCrawlRun");
  }

  const tracking: CrawlerV2Stage[] = [];
  await scheduleIdentityApprovalCrawls("sra:1", "sra_organisation", {
    deps: {
      scheduleRun: async (args) => {
        tracking.push(args.stage);
        return "ok";
      },
    },
  });
  if (tracking.join(",") !== "discover_website,extract_contacts,extract_practice_areas") {
    fail(`unexpected crawl stages scheduled: ${tracking.join(",")}`);
  }

  let backgroundDone = false;
  kickOffIdentityApprovalCrawls("sra:1", "sra_organisation", {
    deps: {
      scheduleRun: async () => {
        await new Promise((r) => setTimeout(r, 80));
        backgroundDone = true;
        return "ok";
      },
    },
  });
  if (backgroundDone) {
    fail("crawl scheduling should be non-blocking");
  }
  await new Promise((r) => setTimeout(r, 120));
  if (!backgroundDone) {
    fail("background crawl scheduling should complete after caller returns");
  }

  if (failed === 0) {
    console.log("PASS sra-identity-approve eval");
  }

  return failed;
}
