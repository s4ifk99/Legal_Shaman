import { getMaskedDatabaseHost } from "@/lib/admin/api-response";
import { safeOptionalPrisma } from "@/lib/db/safe-optional-prisma";
import { getCatalogStats } from "@/lib/search-index/catalog-stats";
import { runProdHealth } from "@/lib/ops/prod-health";
import { readOpsJobState } from "@/lib/ops/job-state";
import { countIndexingJobsByStatus, listIndexingJobs } from "@/lib/ops/indexing-jobs";
import { getLatestIndexBuildForStatus } from "@/lib/ops/search-index-builds";
import { getEnvironmentSnapshot } from "@/lib/ops/environment-guard";

function maskHost(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return `${u.hostname}${u.port ? `:${u.port}` : ""}`;
  } catch {
    return "(unparseable)";
  }
}

export async function getOpsDashboard() {
  const [health, catalog, jobState, indexBuild, indexingCounts] = await Promise.all([
    runProdHealth(),
    getCatalogStats(),
    readOpsJobState(),
    getLatestIndexBuildForStatus(),
    countIndexingJobsByStatus().catch(() => ({})),
  ]);

  const pendingEnrichment = await safeOptionalPrisma(
    "providerEnrichment.count",
    (db) =>
      db.providerEnrichment.count({
        where: { status: { in: ["pending_review", "audit_review"] } },
      }),
    0,
  );

  const [queuedJobs, failedJobs] = await Promise.all([
    listIndexingJobs({ status: "queued", limit: 20 }).catch(() => []),
    listIndexingJobs({ status: "failed", limit: 20 }).catch(() => []),
  ]);

  const env = getEnvironmentSnapshot();
  let errorsJson: string[] = [];
  if (indexBuild?.errorsJson) {
    try {
      errorsJson = JSON.parse(indexBuild.errorsJson) as string[];
    } catch {
      errorsJson = [indexBuild.errorsJson];
    }
  }

  return {
    health,
    environment: env,
    databaseHostMasked: getMaskedDatabaseHost(),
    typesenseHostMasked: maskHost(process.env.TYPESENSE_HOST),
    catalog,
    pendingEnrichmentCount: pendingEnrichment,
    indexingJobCounts: indexingCounts,
    queuedIndexingJobs: queuedJobs,
    failedIndexingJobs: failedJobs,
    lastDailyJob: jobState.daily,
    lastWeeklyJob: jobState.weekly,
    lastRefreshApproved: jobState.refreshApproved,
    lastIndexBuild: indexBuild
      ? {
          id: indexBuild.id,
          source: indexBuild.source,
          environment: indexBuild.environment,
          status: indexBuild.status,
          startedAt: indexBuild.startedAt.toISOString(),
          completedAt: indexBuild.completedAt?.toISOString() ?? null,
          documentCount: indexBuild.documentCount,
          sraCount: indexBuild.sraCount,
          legalAidCount: indexBuild.legalAidCount,
          proBonoCount: indexBuild.proBonoCount,
          errors: errorsJson,
        }
      : null,
    cliCommands: [
      "npm run prod:health",
      "npm run jobs:daily -- --allow-local --yes",
      "npm run jobs:weekly -- --allow-local --yes",
      "npm run jobs:refresh-approved -- --allow-local --yes",
      "npm run index:provider -- --id=sra:123456 --source=sra",
      "npm run search:index:verify",
    ],
  };
}

export async function getIndexBuildStatusForPublicApi() {
  const build = await getLatestIndexBuildForStatus();
  if (!build) {
    return {
      lastIndexBuildAt: process.env.SEARCH_INDEX_BUILT_AT ?? null,
      lastIndexStatus: null,
      lastIndexSource: null,
      lastIndexCounts: null,
      lastIndexErrors: null,
    };
  }
  let errors: string[] | null = null;
  if (build.errorsJson) {
    try {
      errors = JSON.parse(build.errorsJson) as string[];
    } catch {
      errors = [build.errorsJson];
    }
  }
  return {
    lastIndexBuildAt: build.completedAt?.toISOString() ?? build.startedAt.toISOString(),
    lastIndexStatus: build.status,
    lastIndexSource: build.source,
    lastIndexCounts: {
      documentCount: build.documentCount,
      sraCount: build.sraCount,
      legalAidCount: build.legalAidCount,
      proBonoCount: build.proBonoCount,
    },
    lastIndexErrors: errors,
  };
}
