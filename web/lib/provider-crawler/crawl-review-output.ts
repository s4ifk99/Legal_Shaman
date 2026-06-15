import type { CrawlReviewPendingLoadResult } from "@/lib/provider-crawler/crawl-review-datasource";
import type { PendingExtractedField } from "@/lib/provider-crawler/review-queue";

export type ProvidersCrawlReviewOutput = {
  event: "providers_crawl_review";
  ok: boolean;
  degraded: boolean;
  dataSource: {
    providerExtractedField: { ok: true; rowsLoaded: number } | { ok: false; error: string };
  };
  pendingCount: number | null;
  pending: PendingExtractedField[] | null;
  queuedJobs?: number;
};

export function buildProvidersCrawlReviewOutput(args: {
  pending: CrawlReviewPendingLoadResult;
  queuedJobs?: number;
  previewLimit?: number;
}): ProvidersCrawlReviewOutput {
  const previewLimit = args.previewLimit ?? 20;

  if (!args.pending.ok) {
    return {
      event: "providers_crawl_review",
      ok: false,
      degraded: true,
      dataSource: {
        providerExtractedField: { ok: false, error: args.pending.error },
      },
      pendingCount: null,
      pending: null,
    };
  }

  const pending = args.pending.pending;
  return {
    event: "providers_crawl_review",
    ok: true,
    degraded: false,
    dataSource: {
      providerExtractedField: { ok: true, rowsLoaded: pending.length },
    },
    pendingCount: pending.length,
    pending: pending.slice(0, previewLimit),
    ...(args.queuedJobs !== undefined ? { queuedJobs: args.queuedJobs } : {}),
  };
}

export function providersCrawlReviewExitCode(output: ProvidersCrawlReviewOutput): number {
  return output.ok ? 0 : 1;
}
