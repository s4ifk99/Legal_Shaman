import type { CrawlerV2Stage } from "@/lib/provider-intelligence-crawler-v2/types";
import {
  crawlScheduleErrorMessage,
  scheduleCrawlRun,
} from "@/lib/provider-intelligence-crawler-v2/scheduler";
import { isDbTimeoutError } from "@/lib/sra/missing-identity-recovery/load-organisation-batch";

export type IdentityCrawlStage = {
  stage: CrawlerV2Stage;
  priority: number;
};

export const IDENTITY_APPROVAL_CRAWL_STAGES: IdentityCrawlStage[] = [
  { stage: "discover_website", priority: 10 },
  { stage: "extract_contacts", priority: 9 },
  { stage: "extract_practice_areas", priority: 8 },
];

export type ScheduleIdentityCrawlResult = {
  scheduled: number;
  failed: number;
  failures: { stage: CrawlerV2Stage; code: string; message: string }[];
};

export type ScheduleIdentityCrawlDeps = {
  scheduleRun?: typeof scheduleCrawlRun;
};

function errorCode(err: unknown): string {
  if (err && typeof err === "object" && "code" in err) {
    return String((err as { code?: string }).code ?? "unknown");
  }
  if (isDbTimeoutError(err)) return "ETIMEDOUT";
  return "unknown";
}

/** Schedule post-approval crawl runs; failures are logged and never thrown. */
export async function scheduleIdentityApprovalCrawls(
  entityId: string,
  entityType: string,
  opts?: { skipCrawl?: boolean; deps?: ScheduleIdentityCrawlDeps },
): Promise<ScheduleIdentityCrawlResult> {
  if (opts?.skipCrawl) {
    return { scheduled: 0, failed: 0, failures: [] };
  }

  const scheduleRun = opts?.deps?.scheduleRun ?? scheduleCrawlRun;
  const failures: ScheduleIdentityCrawlResult["failures"] = [];
  let scheduled = 0;

  for (const { stage, priority } of IDENTITY_APPROVAL_CRAWL_STAGES) {
    try {
      await scheduleRun({ entityId, entityType, stage, priority });
      scheduled++;
    } catch (err) {
      const code = errorCode(err);
      const message = crawlScheduleErrorMessage(err);
      failures.push({ stage, code, message });
      console.warn(
        JSON.stringify({
          event: "sra_identity_crawl_schedule_failed",
          entityId,
          stage,
          code,
          message,
        }),
      );
    }
  }

  return { scheduled, failed: failures.length, failures };
}

/** Fire-and-forget crawl scheduling; never blocks the caller. */
export function kickOffIdentityApprovalCrawls(
  entityId: string,
  entityType: string,
  opts?: { skipCrawl?: boolean; deps?: ScheduleIdentityCrawlDeps },
): void {
  if (opts?.skipCrawl) return;

  void scheduleIdentityApprovalCrawls(entityId, entityType, opts).catch((err) => {
    console.warn(
      JSON.stringify({
        event: "sra_identity_crawl_schedule_failed",
        entityId,
        stage: "_background",
        code: "unknown",
        message: crawlScheduleErrorMessage(err),
      }),
    );
  });
}
