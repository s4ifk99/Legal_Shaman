/**
 * Missing SRA Identity Recovery Agent — recover real firm names for placeholder SRA rows.
 *
 * Ladder: local search_text → SRA API → Serper → Law Society (optional). Yell is off by default.
 *
 * Usage:
 *   npm run sra:recover:identities -- --limit=100 --dry-run
 *   npm run sra:recover:identities -- --limit=100 --resume
 *   npm run sra:recover:identities -- --sra=209634 --debug
 *   npm run sra:recover:identities -- --sra=209634 --debug --show-active-handles
 *
 * Dry-run writes identity candidates (pending_review) only; use
 * npm run sra:identity-candidates:approve to promote safe rows onto sra_organisations.
 */
import "./load-dotenv";

import type { PrismaClient } from "@prisma/client";
import { createPrismaClient } from "../lib/db/prisma";
import { runMissingIdentityRecovery } from "../lib/sra/missing-identity-recovery/orchestrator";
import {
  cleanupRecoveryProcess,
  logRecoveryLifecycle,
  snapshotActiveHandles,
} from "../lib/sra/missing-identity-recovery/process-shutdown";
import { parseCliLimit } from "../lib/provider-enrichment-ladder/ladder-cli";
import {
  createStartupTiming,
  markStartupStage,
} from "../lib/sra/missing-identity-recovery/startup-timing";

function parseSra(argv: string[]): string | undefined {
  const flag = argv.find((a) => a.startsWith("--sra="));
  if (flag) return flag.split("=")[1]?.trim();
  const idx = argv.indexOf("--sra");
  if (idx >= 0 && argv[idx + 1]) return argv[idx + 1]!.trim();
  return undefined;
}

function parseFlagValue(argv: string[], name: string): string | undefined {
  const eq = argv.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.split("=")[1]?.trim();
  const idx = argv.indexOf(name);
  if (idx >= 0 && argv[idx + 1] && !argv[idx + 1]!.startsWith("--")) {
    return argv[idx + 1]!.trim();
  }
  return undefined;
}

function parseTake(argv: string[]): number {
  const takeRaw = parseFlagValue(argv, "--take");
  if (takeRaw) {
    const n = Number(takeRaw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const limitEq = argv.find((a) => a.startsWith("--limit="));
  if (limitEq) {
    const n = Number(limitEq.split("=")[1]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const limitIdx = argv.indexOf("--limit");
  if (limitIdx >= 0 && argv[limitIdx + 1]) {
    const n = Number(argv[limitIdx + 1]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return parseCliLimit(argv, 100);
}

async function shutdownAndExit(
  prisma: PrismaClient,
  exitCode: number,
  opts: { debug: boolean; showActiveHandles: boolean },
): Promise<never> {
  const beforeShutdownExtra: Record<string, unknown> = {};
  if (opts.showActiveHandles) {
    beforeShutdownExtra.activeHandlesBeforeShutdown = snapshotActiveHandles();
  }
  logRecoveryLifecycle("before_shutdown", beforeShutdownExtra);

  const cleanup = await cleanupRecoveryProcess({
    prisma,
    closeLawSociety: true,
    debug: opts.debug,
  });

  const afterCleanupExtra: Record<string, unknown> = { cleanup };
  if (opts.showActiveHandles) {
    afterCleanupExtra.activeHandlesAfterCleanup = snapshotActiveHandles();
  }
  logRecoveryLifecycle("after_cleanup", afterCleanupExtra);

  process.exit(exitCode);
}

async function main() {
  const argv = process.argv;
  const debug = argv.includes("--debug");
  const startupDebug = argv.includes("--startup-debug");
  const showActiveHandles = argv.includes("--show-active-handles");
  const onlyAddressLike = argv.includes("--only-address-like");
  const onlyPlaceholders =
    argv.includes("--only-placeholders") ||
    (!onlyAddressLike && !argv.includes("--all"));

  const startupTiming = createStartupTiming(startupDebug);

  markStartupStage(startupTiming, "beforePrismaInit");
  const prisma = createPrismaClient({ quiet: true });
  markStartupStage(startupTiming, "afterPrismaInit");

  const result = await runMissingIdentityRecovery(prisma, {
    take: parseTake(argv),
    limit: parseTake(argv),
    dryRun: argv.includes("--dry-run"),
    resume: argv.includes("--resume"),
    resumeAfter: parseFlagValue(argv, "--resume-after"),
    debug,
    startupDebug,
    startupTiming,
    sraId: parseSra(argv),
    includeLawSociety: argv.includes("--include-lawsociety"),
    includeYellIdentity: argv.includes("--include-yell-identity"),
    onlyPlaceholders,
    onlyAddressLike,
  });

  logRecoveryLifecycle("before_summary");
  console.info(JSON.stringify(result, null, 2));
  logRecoveryLifecycle("after_summary", {
    scanned: result.scanned,
    recovered: result.recovered,
    failed: result.failed,
    unresolved: result.unresolved,
  });

  const exitCode = result.degraded
    ? 1
    : result.failed > result.scanned / 2 && result.recovered === 0
      ? 1
      : 0;

  await shutdownAndExit(prisma, exitCode, { debug, showActiveHandles });
}

main().catch(async (e) => {
  logRecoveryLifecycle("before_summary", { error: true });
  console.info(
    JSON.stringify({
      event: "sra_recover_identities",
      degraded: true,
      loadError: e instanceof Error ? e.message.split("\n")[0] : String(e),
      scanned: 0,
      recovered: 0,
    }),
  );
  logRecoveryLifecycle("after_summary", { error: true });

  let prisma: PrismaClient | undefined;
  try {
    prisma = createPrismaClient({ quiet: true });
  } catch {
    /* optional */
  }

  const debug = process.argv.includes("--debug");
  const showActiveHandles = process.argv.includes("--show-active-handles");
  await cleanupRecoveryProcess({
    prisma,
    closeLawSociety: true,
    debug,
  });
  if (showActiveHandles) {
    logRecoveryLifecycle("after_cleanup", {
      activeHandlesAfterCleanup: snapshotActiveHandles(),
    });
  }
  process.exit(1);
});
