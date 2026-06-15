import {
  claimIndexingJob,
  completeIndexingJob,
  failIndexingJob,
  listIndexingJobs,
} from "@/lib/ops/indexing-jobs";
import { indexSingleProvider } from "@/lib/ops/incremental-index";
import { logJobEvent } from "@/lib/ops/job-runner";
import { writeOpsJobRun } from "@/lib/ops/job-state";

export type RefreshApprovedResult = {
  ok: boolean;
  processed: number;
  succeeded: number;
  failed: number;
  errors: string[];
};

async function indexingQueueAvailable(): Promise<boolean> {
  try {
    await listIndexingJobs({ status: "queued", limit: 1 });
    return true;
  } catch {
    return false;
  }
}

export async function runRefreshApprovedJobs(opts?: {
  limit?: number;
}): Promise<RefreshApprovedResult> {
  const limit = opts?.limit ?? 100;
  if (!(await indexingQueueAvailable())) {
    return {
      ok: true,
      processed: 0,
      succeeded: 0,
      failed: 0,
      errors: [],
    };
  }
  const queued = await listIndexingJobs({ status: "queued", limit });
  const errors: string[] = [];
  let succeeded = 0;
  let failed = 0;

  for (const job of queued) {
    const claimed = await claimIndexingJob(job.id);
    if (!claimed) continue;

    const result = await indexSingleProvider(
      job.entityId,
      job.entitySource as "sra" | "legal_aid" | "probono" | "curated" | "lawyers",
    );

    if (result.ok) {
      await completeIndexingJob(job.id);
      succeeded++;
    } else {
      await failIndexingJob(job.id, result.error);
      errors.push(`${job.entityId}: ${result.error}`);
      failed++;
    }
  }

  const ok = failed === 0;
  const summary: RefreshApprovedResult = {
    ok,
    processed: succeeded + failed,
    succeeded,
    failed,
    errors,
  };

  logJobEvent("jobs_refresh_approved_complete", summary);
  return summary;
}

export async function runRefreshApprovedAndRecord(): Promise<RefreshApprovedResult> {
  const startedAt = new Date().toISOString();
  const result = await runRefreshApprovedJobs();
  await writeOpsJobRun("refreshApproved", {
    status: result.ok ? "completed" : "failed",
    startedAt,
    completedAt: new Date().toISOString(),
    errors: result.errors,
  });
  return result;
}
