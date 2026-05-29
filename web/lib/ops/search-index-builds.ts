import { getEnvironmentSnapshot } from "@/lib/ops/environment-guard";
import { getMaskedDatabaseHost } from "@/lib/admin/api-response";
import { prisma } from "@/lib/db/prisma";
import { safeOptionalPrisma } from "@/lib/db/safe-optional-prisma";
import type { IndexSource } from "@/lib/search-index/types";

export type BuildStatus = "running" | "completed" | "failed";

function maskTypesenseHost(): string | null {
  const raw = process.env.TYPESENSE_HOST?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return `${u.hostname}${u.port ? `:${u.port}` : ""}`;
  } catch {
    return raw.replace(/\/\/[^@]+@/, "//***@");
  }
}

async function indexingTablesReady(): Promise<boolean> {
  try {
    await prisma.searchIndexBuild.findFirst({ take: 1 });
    return true;
  } catch {
    return false;
  }
}

export async function startSearchIndexBuild(source: string): Promise<{ id: string } | null> {
  if (!(await indexingTablesReady())) return null;
  const env = getEnvironmentSnapshot();
  const row = await prisma.searchIndexBuild.create({
    data: {
      source,
      environment: env.vercelEnv ?? env.nodeEnv,
      databaseHost: getMaskedDatabaseHost(),
      typesenseHost: maskTypesenseHost(),
      status: "running",
    },
  });
  return { id: row.id };
}

export async function completeSearchIndexBuild(
  id: string | null | undefined,
  args: {
    status: BuildStatus;
    documentCount?: number;
    sraCount?: number;
    legalAidCount?: number;
    proBonoCount?: number;
    errors?: string[];
  },
): Promise<void> {
  if (!id) return;
  await prisma.searchIndexBuild.update({
    where: { id },
    data: {
      status: args.status,
      completedAt: new Date(),
      documentCount: args.documentCount ?? null,
      sraCount: args.sraCount ?? null,
      legalAidCount: args.legalAidCount ?? null,
      proBonoCount: args.proBonoCount ?? null,
      errorsJson: args.errors?.length ? JSON.stringify(args.errors.slice(0, 50)) : null,
    },
  });

  if (args.status === "completed") {
    process.env.SEARCH_INDEX_BUILT_AT = new Date().toISOString();
  }
}

export async function getLatestSearchIndexBuild(source?: string) {
  return safeOptionalPrisma(
    "searchIndexBuild.findFirst.latest",
    (db) =>
      db.searchIndexBuild.findFirst({
        where: source ? { source } : undefined,
        orderBy: { startedAt: "desc" },
      }),
    null,
  );
}

export async function getLatestIndexBuildForStatus() {
  return safeOptionalPrisma(
    "searchIndexBuild.findFirst",
    (db) =>
      db.searchIndexBuild.findFirst({
        where: { source: { notIn: ["jobs:daily", "jobs:weekly", "jobs:refresh-approved"] } },
        orderBy: { startedAt: "desc" },
      }),
    null,
  );
}

export function indexSourceLabel(source: IndexSource | string): string {
  return source;
}
