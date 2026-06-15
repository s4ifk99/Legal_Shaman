import { getOptionalPrismaClient } from "@/lib/db/prisma";
import { resetOptionalPrismaWarnDedupe, safeOptionalPrisma } from "@/lib/db/safe-optional-prisma";
import { loadBehaviouralSignalsForEntities } from "@/lib/search-events/load-ranking-signals";
import { getCatalogStats } from "@/lib/search-index/catalog-stats";

export async function runOptionalPrismaEval(): Promise<number> {
  resetOptionalPrismaWarnDedupe();
  let failed = 0;
  const fail = (msg: string) => {
    console.error(`FAIL optional-prisma: ${msg}`);
    failed++;
  };

  const ok = await safeOptionalPrisma("eval.safe.ok", async () => 7, 0);
  if (ok !== 7) fail("safeOptionalPrisma should return success value");

  const warnLines: string[] = [];
  const prevWarn = console.warn;
  console.warn = (msg?: unknown, ...rest: unknown[]) => {
    warnLines.push(typeof msg === "string" ? msg : String(msg));
    prevWarn(msg, ...rest);
  };
  try {
    const fallback = await safeOptionalPrisma(
      "eval.safe.fail",
      async () => {
        throw new Error("simulated unavailable");
      },
      null,
    );
    if (fallback !== null) fail("safeOptionalPrisma should return fallback on error");

    const warn = warnLines.find((l) => l.includes("optional_prisma_query_unavailable"));
    if (!warn) fail("safeOptionalPrisma should emit structured warning");
    else {
      const parsed = JSON.parse(warn) as {
        event?: string;
        queryName?: string;
        reason?: string;
      };
      if (parsed.event !== "optional_prisma_query_unavailable") {
        fail("warning event name mismatch");
      }
      if (parsed.queryName !== "eval.safe.fail" || !parsed.reason?.includes("simulated")) {
        fail("warning payload mismatch");
      }
    }
  } finally {
    console.warn = prevWarn;
  }

  const db = getOptionalPrismaClient();
  const origCount = db.sraOrganisation.count.bind(db.sraOrganisation);
  db.sraOrganisation.count = (async () => {
    throw new Error("relation \"SraOrganisation\" does not exist");
  }) as typeof db.sraOrganisation.count;

  try {
    const stats = await getCatalogStats();
    if (stats.sraPostgresCount !== null) {
      fail("getCatalogStats should return null sraPostgresCount when count fails");
    }
  } catch (e) {
    fail(`getCatalogStats should not throw: ${e instanceof Error ? e.message : e}`);
  } finally {
    db.sraOrganisation.count = origCount;
  }

  const origFindMany = db.searchRankingSignal.findMany.bind(db.searchRankingSignal);
  db.searchRankingSignal.findMany = (async () => {
    throw new Error("relation \"SearchRankingSignal\" does not exist");
  }) as typeof db.searchRankingSignal.findMany;

  try {
    const signals = await loadBehaviouralSignalsForEntities(
      [{ id: "entity-1", source: "curated_listing" }],
      { practiceArea: "employment" },
    );
    if (signals.size !== 0) {
      fail("loadBehaviouralSignalsForEntities should degrade to empty map");
    }
  } catch (e) {
    fail(
      `loadBehaviouralSignalsForEntities should not throw: ${e instanceof Error ? e.message : e}`,
    );
  } finally {
    db.searchRankingSignal.findMany = origFindMany;
  }

  const prevForce = process.env.SEARCH_SIGNALS_FORCE_UNAVAILABLE;
  try {
    process.env.SEARCH_SIGNALS_FORCE_UNAVAILABLE = "1";
    const forced = await loadBehaviouralSignalsForEntities(
      [{ id: "entity-2", source: "curated_listing" }],
      {},
    );
    if (forced.size !== 0) {
      fail("SEARCH_SIGNALS_FORCE_UNAVAILABLE should return empty map");
    }
  } finally {
    if (prevForce == null) delete process.env.SEARCH_SIGNALS_FORCE_UNAVAILABLE;
    else process.env.SEARCH_SIGNALS_FORCE_UNAVAILABLE = prevForce;
  }

  if (failed === 0) {
    console.info(
      "PASS optional prisma eval (safe fallback, catalog stats, behavioural signals)",
    );
  }
  return failed;
}
