import { runProdHealth } from "@/lib/ops/prod-health";
import { logJobEvent, runJobStep, runNpmStep, summarizeSteps } from "@/lib/ops/job-runner";
import { writeOpsJobRun } from "@/lib/ops/job-state";
import { runRefreshApprovedJobs } from "@/lib/ops/jobs-refresh-approved";

export type DailyJobResult = {
  ok: boolean;
  startedAt: string;
  completedAt: string;
  steps: { name: string; ok: boolean; detail?: string }[];
  errors: string[];
};

export async function runDailyJobs(): Promise<DailyJobResult> {
  const startedAt = new Date().toISOString();
  const steps = [];

  steps.push(
    await runJobStep("prod:health", async () => {
      const health = await runProdHealth();
      return { ok: health.ok, detail: health.ok ? undefined : health.checks.filter((c) => !c.ok).map((c) => c.name).join(", ") };
    }),
  );

  steps.push(await runNpmStep("providers:coverage-report", "providers:coverage-report"));

  steps.push(
    await runNpmStep(
      "providers:enrich:weak",
      "providers:enrich:weak",
      ["--limit=100", "--missing-contact-only"],
    ),
  );

  steps.push(
    await runJobStep("jobs:refresh-approved", async () => {
      const refresh = await runRefreshApprovedJobs({ limit: 50 });
      return {
        ok: refresh.ok,
        detail: `processed=${refresh.processed} failed=${refresh.failed}`,
      };
    }),
  );

  steps.push(await runNpmStep("search:index:verify", "search:index:verify"));

  const summary = summarizeSteps(steps);
  const completedAt = new Date().toISOString();
  const result: DailyJobResult = {
    ok: summary.ok,
    startedAt,
    completedAt,
    steps,
    errors: summary.errors,
  };

  await writeOpsJobRun("daily", {
    status: result.ok ? "completed" : "failed",
    startedAt,
    completedAt,
    steps,
    errors: result.errors,
  });

  logJobEvent("jobs_daily_complete", result);
  return result;
}
