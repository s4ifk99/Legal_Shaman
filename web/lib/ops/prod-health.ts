import { getOptionalPrismaClient, prisma } from "@/lib/db/prisma";
import { buildTypesenseListingsClientFromEnv } from "@/lib/search/typesense-listings-client";
import { LEGAL_ENTITIES_COLLECTION } from "@/lib/search-index/config";
import { getEnvironmentSnapshot } from "@/lib/ops/environment-guard";
import { shouldRunTypesenseOps, typesenseOptionalForOps } from "@/lib/ops/typesense-host";

export type ProdHealthCheck = {
  name: string;
  ok: boolean;
  detail?: string;
};

export type DatabaseHealthDetail = {
  databaseReachable: boolean;
  rawQueryHealthy: boolean;
  method?: string;
  errorDetail?: string;
};

export type ProdHealthReport = {
  ok: boolean;
  checks: ProdHealthCheck[];
  environment: ReturnType<typeof getEnvironmentSnapshot>;
  database?: DatabaseHealthDetail;
};

function formatPrismaError(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const parts: string[] = [`name=${e.name}`];
  const code = (e as Error & { code?: string }).code;
  if (code) parts.push(`code=${code}`);
  parts.push(`message=${e.message?.trim() || "(empty)"}`);
  if (e.stack) {
    const head = e.stack
      .split("\n")
      .slice(0, 4)
      .map((l) => l.trim())
      .join(" | ");
    parts.push(`stack=${head}`);
  }
  return parts.join("; ");
}

async function tryModelCount(): Promise<{ ok: boolean; method: string; detail?: string }> {
  const db = getOptionalPrismaClient();
  const attempts: { method: string; run: () => Promise<number> }[] = [
    { method: "searchInteraction.count", run: () => db.searchInteraction.count() },
    { method: "sraOrganisation.count", run: () => db.sraOrganisation.count() },
    { method: "firm.count", run: () => db.firm.count() },
  ];

  const failures: string[] = [];
  for (const { method, run } of attempts) {
    try {
      const count = await run();
      return { ok: true, method, detail: `count=${count}` };
    } catch (e) {
      failures.push(`${method}: ${formatPrismaError(e)}`);
    }
  }
  return { ok: false, method: "none", detail: failures.join(" || ") };
}

export async function checkDatabase(): Promise<{
  check: ProdHealthCheck;
  database: DatabaseHealthDetail;
}> {
  let rawQueryHealthy = false;
  let databaseReachable = false;
  let method: string | undefined;
  const errors: string[] = [];

  try {
    try {
      await prisma.$queryRawUnsafe("SELECT 1");
      rawQueryHealthy = true;
      databaseReachable = true;
      method = "queryRawUnsafe(SELECT 1)";
    } catch (rawErr) {
      errors.push(`rawQuery: ${formatPrismaError(rawErr)}`);

      try {
        await prisma.$connect();
        databaseReachable = true;
        method = "$connect";

        const counted = await tryModelCount();
        if (counted.ok) {
          method = `${method}+${counted.method}`;
          if (counted.detail) errors.push(`fallback: ${counted.detail}`);
        } else if (counted.detail) {
          errors.push(`count: ${counted.detail}`);
        }
      } catch (connectErr) {
        errors.push(`connect: ${formatPrismaError(connectErr)}`);
        databaseReachable = false;
      }
    }
  } finally {
    try {
      await prisma.$disconnect();
    } catch {
      // ignore disconnect errors in health probe
    }
  }

  const errorDetail = errors.length > 0 ? errors.join(" || ") : undefined;
  const database: DatabaseHealthDetail = {
    databaseReachable,
    rawQueryHealthy,
    method,
    errorDetail,
  };

  const detailParts = [
    `databaseReachable=${databaseReachable}`,
    `rawQueryHealthy=${rawQueryHealthy}`,
    method ? `method=${method}` : undefined,
    errorDetail,
  ].filter(Boolean);

  const check: ProdHealthCheck = {
    name: "database",
    ok: databaseReachable,
    detail: databaseReachable && rawQueryHealthy ? undefined : detailParts.join("; "),
  };

  return { check, database };
}

async function checkTypesense(): Promise<ProdHealthCheck> {
  const tsOps = await shouldRunTypesenseOps();
  if (!tsOps.run) {
    return {
      name: "typesense",
      ok: typesenseOptionalForOps(),
      detail: tsOps.reason,
    };
  }

  const client = buildTypesenseListingsClientFromEnv();
  if (!client) {
    return { name: "typesense", ok: false, detail: "TYPESENSE_HOST or TYPESENSE_API_KEY missing" };
  }
  try {
    const col = await client.collections(LEGAL_ENTITIES_COLLECTION).retrieve();
    const count = (col as { num_documents?: number }).num_documents ?? 0;
    if (count < 1) {
      return { name: "typesense", ok: false, detail: `collection ${LEGAL_ENTITIES_COLLECTION} is empty` };
    }
    return { name: "typesense", ok: true, detail: `documents=${count}` };
  } catch (e) {
    return {
      name: "typesense",
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

function checkRequiredEnv(): ProdHealthCheck[] {
  const env = getEnvironmentSnapshot();
  const checks: ProdHealthCheck[] = [];
  checks.push({
    name: "env_database_url",
    ok: Boolean(process.env.DATABASE_URL?.trim()),
  });
  checks.push({
    name: "env_typesense",
    ok: Boolean(process.env.TYPESENSE_HOST?.trim() && process.env.TYPESENSE_API_KEY?.trim()),
  });
  const isProd = env.nodeEnv === "production" || env.vercelEnv === "production";
  if (isProd) {
    checks.push({
      name: "env_admin_secret",
      ok: env.adminSecretConfigured,
      detail: env.adminSecretConfigured ? undefined : "ADMIN_SECRET required in production",
    });
    checks.push({
      name: "env_search_event_salt",
      ok: env.searchEventSaltConfigured,
      detail: env.searchEventSaltConfigured ? undefined : "SEARCH_EVENT_SALT required in production",
    });
  }
  return checks;
}

export async function runProdHealth(): Promise<ProdHealthReport> {
  const environment = getEnvironmentSnapshot();
  const dbHealth = await checkDatabase();
  const checks: ProdHealthCheck[] = [
    ...checkRequiredEnv(),
    dbHealth.check,
    await checkTypesense(),
  ];
  const ok = checks.every((c) => c.ok);
  return { ok, checks, environment, database: dbHealth.database };
}
