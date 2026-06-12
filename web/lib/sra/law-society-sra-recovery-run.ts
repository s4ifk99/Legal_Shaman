import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import {
  closeLawSocietyBrowser,
  lawSocietyResultToRegisterLookup,
  lookupLawSocietyBySraId,
} from "@/lib/sra/law-society-sra-recovery";
import { applySraRegisterLookupToRow } from "@/lib/sra/register-name-backfill";
import { isPlaceholderSraDisplayName } from "@/lib/sra/sra-name-quality";

export type LawSocietyRecoveryBatchOptions = {
  limit?: number;
  dryRun?: boolean;
  resume?: boolean;
  debug?: boolean;
  sraId?: string;
  /** Only rows with placeholder display names (default true for batch runs). */
  onlyPlaceholders?: boolean;
  /** Pause after each firm (ms). Default from env or 90s in slow mode. */
  delayBetweenMs?: number;
  /** Firms per batch before a long pause + browser restart. */
  batchSize?: number;
  /** Pause between batches (ms). Default 5 min in slow mode. */
  batchPauseMs?: number;
  /** Preset: 3 per batch, 90s between firms, 5min between batches, checkpoint every firm. */
  slow?: boolean;
};

export type LawSocietyRecoveryBatchResult = {
  event: "law_society_sra_recovery";
  scanned: number;
  recovered: number;
  updated: number;
  notFound: number;
  multipleMatches: number;
  websiteRecovered: number;
  phoneRecovered: number;
  failed: number;
  captchaBlocked: number;
  dryRun: boolean;
  resumedFrom?: string;
  slow?: boolean;
  delayBetweenMs?: number;
  batchSize?: number;
};

const CHECKPOINT_DIR = path.join(process.cwd(), ".cache/law-society-sra-recovery");
const CHECKPOINT_FILE = path.join(CHECKPOINT_DIR, "checkpoint.json");
const PROGRESS_FILE = path.join(CHECKPOINT_DIR, "progress.jsonl");

type Checkpoint = {
  lastProcessedSraId?: string;
  totalScanned?: number;
  totalUpdated?: number;
};

function resolveTiming(opts: LawSocietyRecoveryBatchOptions) {
  const slow = opts.slow ?? process.env.LAW_SOCIETY_SLOW_BATCH === "1";
  return {
    slow,
    delayBetweenMs:
      opts.delayBetweenMs ??
      Number(
        process.env.LAW_SOCIETY_DELAY_BETWEEN_MS ??
          (slow ? "90000" : "45000"),
      ),
    batchSize:
      opts.batchSize ??
      Number(process.env.LAW_SOCIETY_BATCH_SIZE ?? (slow ? "3" : "5")),
    batchPauseMs:
      opts.batchPauseMs ??
      Number(
        process.env.LAW_SOCIETY_BATCH_PAUSE_MS ??
          (slow ? "300000" : "120000"),
      ),
  };
}

async function loadCheckpoint(): Promise<Checkpoint> {
  try {
    return JSON.parse(await readFile(CHECKPOINT_FILE, "utf8")) as Checkpoint;
  } catch {
    return {};
  }
}

async function saveCheckpoint(cp: Checkpoint): Promise<void> {
  await mkdir(CHECKPOINT_DIR, { recursive: true });
  await writeFile(CHECKPOINT_FILE, JSON.stringify(cp, null, 2), "utf8");
}

async function appendProgress(line: Record<string, unknown>): Promise<void> {
  await mkdir(CHECKPOINT_DIR, { recursive: true });
  await writeFile(
    PROGRESS_FILE,
    `${JSON.stringify({ ts: new Date().toISOString(), ...line })}\n`,
    { flag: "a" },
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function log(msg: string, data?: Record<string, unknown>): void {
  console.info(
    JSON.stringify({
      event: "law_society_batch_progress",
      msg,
      ...data,
    }),
  );
}

export async function runLawSocietySraRecovery(
  prisma: PrismaClient,
  opts: LawSocietyRecoveryBatchOptions = {},
): Promise<LawSocietyRecoveryBatchResult> {
  const limit = opts.limit ?? 100;
  const dryRun = opts.dryRun ?? false;
  const onlyPlaceholders = opts.onlyPlaceholders !== false;
  const timing = resolveTiming(opts);

  const result: LawSocietyRecoveryBatchResult = {
    event: "law_society_sra_recovery",
    scanned: 0,
    recovered: 0,
    updated: 0,
    notFound: 0,
    multipleMatches: 0,
    websiteRecovered: 0,
    phoneRecovered: 0,
    failed: 0,
    captchaBlocked: 0,
    dryRun,
    slow: timing.slow,
    delayBetweenMs: timing.delayBetweenMs,
    batchSize: timing.batchSize,
  };

  let resumeAfter: string | undefined;
  const cp = await loadCheckpoint();
  if (opts.resume) {
    resumeAfter = cp.lastProcessedSraId;
    result.resumedFrom = resumeAfter;
  }

  const rows = opts.sraId
    ? await prisma.sraOrganisation.findMany({
        where: { sraId: opts.sraId.replace(/^sra:/i, "") },
      })
    : await prisma.sraOrganisation.findMany({
        where: {
          ...(onlyPlaceholders
            ? { displayName: { startsWith: "SRA organisation" } }
            : {}),
          ...(resumeAfter ? { sraId: { gt: resumeAfter } } : {}),
        },
        orderBy: { sraId: "asc" },
        take: limit,
      });

  let skipping = Boolean(resumeAfter);
  let firmsInCurrentBatch = 0;

  log("batch_start", {
    limit,
    slow: timing.slow,
    delayBetweenMs: timing.delayBetweenMs,
    batchSize: timing.batchSize,
    batchPauseMs: timing.batchPauseMs,
    onlyPlaceholders,
    resumedFrom: resumeAfter,
  });

  try {
    for (const row of rows) {
      if (!opts.sraId && result.scanned >= limit) break;

      if (skipping) {
        if (row.sraId === resumeAfter) skipping = false;
        continue;
      }

      if (
        onlyPlaceholders &&
        !opts.sraId &&
        !isPlaceholderSraDisplayName(row.displayName, row.sraId)
      ) {
        continue;
      }

      if (firmsInCurrentBatch >= timing.batchSize) {
        log("batch_pause", {
          pauseMs: timing.batchPauseMs,
          scanned: result.scanned,
          updated: result.updated,
        });
        await closeLawSocietyBrowser();
        await sleep(timing.batchPauseMs);
        firmsInCurrentBatch = 0;
      }

      result.scanned++;
      firmsInCurrentBatch++;

      log("firm_start", {
        sraId: row.sraId,
        index: result.scanned,
        displayName: row.displayName,
      });

      try {
        const diag = await lookupLawSocietyBySraId(row.sraId, {
          postcodeHint: row.postcode || undefined,
          displayNameHint: row.displayName || row.businessName || undefined,
          debug: opts.debug,
        });

        if (diag.captchaBlocked && !diag.result) {
          result.captchaBlocked++;
        }

        if (opts.debug) {
          console.info(
            JSON.stringify({
              event: "law_society_recovery_debug",
              sraId: row.sraId,
              searchUrl: diag.searchUrl,
              resultCount: diag.resultCount,
              result: diag.result,
              captchaBlocked: diag.captchaBlocked,
            }),
          );
        }

        if (diag.resultCount > 1 && !diag.result) {
          result.multipleMatches++;
          await appendProgress({
            sraId: row.sraId,
            outcome: "multiple_matches",
          });
        } else if (!diag.result || diag.result.matchKind === "not_found") {
          result.notFound++;
          await appendProgress({
            sraId: row.sraId,
            outcome: diag.captchaBlocked ? "captcha_blocked" : "not_found",
          });
        } else if (diag.result.matchKind === "multiple") {
          result.multipleMatches++;
          await appendProgress({ sraId: row.sraId, outcome: "multiple" });
        } else {
          result.recovered++;
          if (diag.result.website) result.websiteRecovered++;
          if (diag.result.phone) result.phoneRecovered++;

          const lookup = lawSocietyResultToRegisterLookup(diag.result);
          const status = await applySraRegisterLookupToRow(prisma, row.id, lookup, {
            dryRun,
            force: false,
          });
          if (status === "updated") result.updated++;

          await appendProgress({
            sraId: row.sraId,
            outcome: status,
            organisationName: diag.result.organisationName,
            confidence: diag.result.confidence,
          });

          log("firm_recovered", {
            sraId: row.sraId,
            name: diag.result.organisationName,
            updated: status === "updated",
          });
        }
      } catch (e) {
        result.failed++;
        await appendProgress({
          sraId: row.sraId,
          outcome: "error",
          error: e instanceof Error ? e.message : String(e),
        });
        if (opts.debug) {
          console.error(
            JSON.stringify({
              event: "law_society_recovery_error",
              sraId: row.sraId,
              error: e instanceof Error ? e.message : String(e),
            }),
          );
        }
      }

      if (!dryRun) {
        await saveCheckpoint({
          lastProcessedSraId: row.sraId,
          totalScanned: (cp.totalScanned ?? 0) + result.scanned,
          totalUpdated: (cp.totalUpdated ?? 0) + result.updated,
        });
      }

      if (!opts.sraId && result.scanned < limit) {
        log("firm_sleep", { pauseMs: timing.delayBetweenMs, sraId: row.sraId });
        await closeLawSocietyBrowser();
        await sleep(timing.delayBetweenMs);
      }
    }
  } finally {
    await closeLawSocietyBrowser();
  }

  log("batch_complete", { ...result });
  return result;
}
