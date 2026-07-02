/**
 * Verify Postgres (pgvector + app tables), Typesense, and core search data.
 * Run: cd web && npm run db:verify
 */
import "./load-dotenv";

import Module from "node:module";

type NodeLoad = (request: string, parent: unknown, isMain: boolean) => unknown;
const nodeModule = Module as typeof Module & { _load: NodeLoad };
const load = nodeModule._load;
nodeModule._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  return load(request, parent, isMain);
};

type Check = { name: string; ok: boolean; detail: string };

async function main() {
  const checks: Check[] = [];
  const fail = (name: string, detail: string) => checks.push({ name, ok: false, detail });
  const pass = (name: string, detail: string) => checks.push({ name, ok: true, detail });

  const { createPrismaClient } = await import("../lib/db/prisma");
  const prisma = createPrismaClient();

  try {
    await prisma.$queryRaw`SELECT 1 AS ok`;
    pass("postgres_connect", "connected");
  } catch (e) {
    fail("postgres_connect", e instanceof Error ? e.message : String(e));
  }

  try {
    const ext = await prisma.$queryRaw<Array<{ extname: string }>>`
      SELECT extname FROM pg_extension WHERE extname IN ('vector', 'pg_trgm')
    `;
    const names = new Set(ext.map((r) => r.extname));
    if (names.has("vector")) pass("pgvector", "extension installed");
    else fail("pgvector", "extension missing — run migrations");
    if (names.has("pg_trgm")) pass("pg_trgm", "extension installed");
    else fail("pg_trgm", "extension missing");
  } catch (e) {
    fail("pgvector", e instanceof Error ? e.message : String(e));
  }

  const tableChecks: Array<{ table: string; min?: number }> = [
    { table: "sra_organisations", min: 1 },
    { table: "legal_chunks", min: 1 },
    { table: "legal_documents", min: 1 },
    { table: "legal_sources", min: 1 },
    { table: "lawyers" },
    { table: "ingestion_runs" },
  ];

  for (const { table, min } of tableChecks) {
    try {
      const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*)::bigint AS count FROM "${table}"`,
      );
      const count = Number(rows[0]?.count ?? 0);
      if (min != null && count < min) {
        fail(`table_${table}`, `count=${count} (expected >= ${min})`);
      } else {
        pass(`table_${table}`, `count=${count}`);
      }
    } catch (e) {
      fail(`table_${table}`, e instanceof Error ? e.message : String(e));
    }
  }

  try {
    const embedded = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM legal_chunks WHERE embedding IS NOT NULL
    `;
    const n = Number(embedded[0]?.count ?? 0);
    if (n > 0) pass("legal_embeddings", `count=${n}`);
    else fail("legal_embeddings", "no embeddings — run npm run ingest:legal-knowledge");
  } catch (e) {
    fail("legal_embeddings", e instanceof Error ? e.message : String(e));
  }

  await prisma.$disconnect();

  const host = process.env.TYPESENSE_HOST?.trim() || "localhost";
  const port = process.env.TYPESENSE_PORT?.trim() || "8108";
  const protocol = process.env.TYPESENSE_PROTOCOL?.trim() || "http";
  const apiKey = process.env.TYPESENSE_API_KEY?.trim();
  const healthUrl = `${protocol}://${host}:${port}/health`;

  try {
    const res = await fetch(healthUrl, { signal: AbortSignal.timeout(5000) });
    if (res.ok) pass("typesense_health", healthUrl);
    else fail("typesense_health", `${res.status} ${healthUrl}`);
  } catch (e) {
    fail("typesense_health", `${healthUrl} — ${e instanceof Error ? e.message : String(e)}`);
  }

  if (apiKey) {
    try {
      const { getSearchStackStatus } = await import("../lib/legal-search/search-startup");
      const stack = await getSearchStackStatus();
      if (stack.typesenseReachable) {
        pass(
          "typesense_legal_entities",
          `collection=${stack.legalEntitiesCollectionExists ? "yes" : "no"} docs=${stack.legalEntitiesDocumentCount ?? 0}`,
        );
      } else {
        fail("typesense_legal_entities", stack.degradedModeWarnings.join("; ") || "unreachable");
      }
    } catch (e) {
      fail("typesense_legal_entities", e instanceof Error ? e.message : String(e));
    }
  } else {
    fail("typesense_api_key", "TYPESENSE_API_KEY not set");
  }

  const meiliHost = process.env.MEILISEARCH_HOST?.trim();
  if (meiliHost) {
    try {
      const key = process.env.MEILISEARCH_API_KEY?.trim() ?? "";
      const res = await fetch(`${meiliHost}/health`, {
        headers: key ? { Authorization: `Bearer ${key}` } : {},
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) pass("meilisearch_health", meiliHost);
      else fail("meilisearch_health", `${res.status}`);
    } catch (e) {
      fail("meilisearch_health", e instanceof Error ? e.message : String(e));
    }
  } else {
    pass("meilisearch_health", "not configured (optional for /search legacy)");
  }

  const failed = checks.filter((c) => !c.ok);
  for (const c of checks) {
    console.info(JSON.stringify({ check: c.name, ok: c.ok, detail: c.detail }));
  }
  console.info(
    JSON.stringify({
      event: "db_verify_summary",
      passed: checks.length - failed.length,
      failed: failed.length,
      total: checks.length,
    }),
  );

  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
