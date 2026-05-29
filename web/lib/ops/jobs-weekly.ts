import { readSraSyncState } from "@/lib/sra/sync-state";
import { getCatalogStats } from "@/lib/search-index/catalog-stats";
import { verifyLegalEntitiesIndex } from "@/lib/search-index/verify-index";
import { syncLegalEntitiesToTypesense } from "@/lib/search-index/sync-typesense";
import { runProdHealth } from "@/lib/ops/prod-health";
import {
  completeSearchIndexBuild,
  startSearchIndexBuild,
} from "@/lib/ops/search-index-builds";
import { logJobEvent, runJobStep, runNpmStep, summarizeSteps } from "@/lib/ops/job-runner";
import { writeOpsJobRun } from "@/lib/ops/job-state";

export type WeeklyJobOptions = {
  force?: boolean;
};

export type WeeklyJobResult = {
  ok: boolean;
  startedAt: string;
  completedAt: string;
  steps: { name: string; ok: boolean; detail?: string }[];
  errors: string[];
  buildId?: string;
};

export async function runWeeklyJobs(opts: WeeklyJobOptions = {}): Promise<WeeklyJobResult> {
  const startedAt = new Date().toISOString();
  const steps = [];
  let buildId: string | undefined;

  steps.push(
    await runJobStep("prod:health", async () => {
      const health = await runProdHealth();
      return { ok: health.ok, detail: health.ok ? undefined : "health checks failed" };
    }),
  );

  const sraStep = await runNpmStep("sra:sync", "sra:sync");
  steps.push(sraStep);

  const syncState = await readSraSyncState();
  const sraPartial =
    sraStep.ok &&
    (syncState.errors.length > 0 ||
      (syncState.organisationsUpserted < 1000 && syncState.lastSuccessAt));

  if (sraPartial && !opts.force) {
    steps.push({
      name: "weekly:index-aborted",
      ok: false,
      exitCode: 1,
      detail: `SRA sync incomplete (${syncState.errors.length} errors, ${syncState.organisationsUpserted} orgs) — pass --force to index anyway`,
    });
    const summary = summarizeSteps(steps);
    const completedAt = new Date().toISOString();
    const result: WeeklyJobResult = {
      ok: false,
      startedAt,
      completedAt,
      steps,
      errors: summary.errors,
    };
    await writeOpsJobRun("weekly", {
      status: "failed",
      startedAt,
      completedAt,
      steps,
      errors: result.errors,
    });
    logJobEvent("jobs_weekly_aborted", result);
    return result;
  }

  const build = await startSearchIndexBuild("weekly");
  buildId = build?.id;

  steps.push(
    await runNpmStep("search:index:sra", "search:index:sra", [], {
      SRA_INDEX_SKIP_GEO: "1",
    }),
  );

  steps.push(
    await runJobStep("search:index:all", async () => {
      const stats = await syncLegalEntitiesToTypesense("all");
      const ok = stats.errors.length === 0 && stats.documentsUpserted > 0;
      return {
        ok,
        detail: ok
          ? `upserted=${stats.documentsUpserted}`
          : stats.errors.slice(0, 3).join("; ") || "no documents upserted",
      };
    }),
  );

  steps.push(
    await runJobStep("search:index:verify", async () => {
      const report = await verifyLegalEntitiesIndex();
      return { ok: report.ok, detail: report.ok ? undefined : `${report.rows.filter((r) => r.status === "fail").length} failures` };
    }),
  );

  steps.push(await runNpmStep("search:eval", "search:eval"));

  const catalog = await getCatalogStats();
  const summary = summarizeSteps(steps);
  const completedAt = new Date().toISOString();
  const buildStatus = summary.ok ? "completed" : "failed";

  await completeSearchIndexBuild(build?.id, {
    status: buildStatus,
    documentCount: catalog.legalEntitiesTotal ?? undefined,
    sraCount: catalog.sraTypesenseCount ?? undefined,
    legalAidCount: catalog.legalAidProviderCount ?? undefined,
    proBonoCount: catalog.proBonoIndexedEstimate ?? undefined,
    errors: summary.errors,
  });

  const result: WeeklyJobResult = {
    ok: summary.ok,
    startedAt,
    completedAt,
    steps,
    errors: summary.errors,
    buildId,
  };

  await writeOpsJobRun("weekly", {
    status: result.ok ? "completed" : "failed",
    startedAt,
    completedAt,
    steps,
    errors: result.errors,
  });

  logJobEvent("jobs_weekly_complete", result);
  return result;
}
