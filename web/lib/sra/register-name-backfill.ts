import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { extractFirmNameFromSraSearchText } from "@/lib/search/sra-display";
import { lookupSraRegisterWithDiagnostics, type SraRegisterLookupResult } from "@/lib/sra/register-lookup";
import { printLookupDiagnostics } from "@/lib/sra/register-lookup-diagnostics";
import {
  classifySraStoredName,
  isPlaceholderSraDisplayName,
} from "@/lib/sra/sra-name-quality";

export type SraNameBackfillOptions = {
  limit?: number;
  offset?: number;
  onlyPlaceholders?: boolean;
  dryRun?: boolean;
  force?: boolean;
  resume?: boolean;
  debug?: boolean;
};

export type SraNameBackfillResult = {
  event: "sra_backfill_names";
  scanned: number;
  lookedUp: number;
  updated: number;
  skippedGoodName: number;
  rejectedAddressLike: number;
  notFound: number;
  failed: number;
  dryRun: boolean;
  resumedFrom?: string;
};

const CHECKPOINT_DIR = path.join(process.cwd(), ".cache/sra-name-backfill");
const CHECKPOINT_FILE = path.join(CHECKPOINT_DIR, "checkpoint.json");

type Checkpoint = {
  lastProcessedSraId?: string;
  updated: number;
  failed: number;
};

async function loadCheckpoint(): Promise<Checkpoint> {
  try {
    const raw = await readFile(CHECKPOINT_FILE, "utf8");
    return JSON.parse(raw) as Checkpoint;
  } catch {
    return { updated: 0, failed: 0 };
  }
}

async function saveCheckpoint(cp: Checkpoint): Promise<void> {
  await mkdir(CHECKPOINT_DIR, { recursive: true });
  await writeFile(CHECKPOINT_FILE, JSON.stringify(cp, null, 2), "utf8");
}

function rebuildSearchText(args: {
  sraId: string;
  displayName: string;
  organisationName: string;
  tradingName: string;
  existingSearchText: string;
  city: string;
  postcode: string;
  phone: string;
}): string {
  const lines = new Set<string>();
  lines.add(args.sraId);
  if (args.displayName) lines.add(args.displayName);
  if (args.organisationName && args.organisationName !== args.displayName) {
    lines.add(args.organisationName);
  }
  if (args.tradingName && args.tradingName !== args.displayName) lines.add(args.tradingName);

  const existingFirm = extractFirmNameFromSraSearchText(args.existingSearchText, args.sraId);
  if (existingFirm && existingFirm !== args.displayName) lines.add(existingFirm);

  if (args.city) lines.add(args.city);
  if (args.postcode) lines.add(args.postcode);
  if (args.phone) lines.add(args.phone);

  return [...lines].join("\n");
}

export async function applySraRegisterLookupToRow(
  prisma: PrismaClient,
  orgId: string,
  lookup: SraRegisterLookupResult,
  opts: { dryRun?: boolean; force?: boolean },
): Promise<"updated" | "skipped" | "rejected" | "not_found"> {
  if (lookup.rejectReason === "address_like_name") return "rejected";
  if (lookup.rejectReason === "not_found" || !lookup.displayName) return "not_found";

  const row = await prisma.sraOrganisation.findUnique({ where: { id: orgId } });
  if (!row) return "not_found";

  const hasGoodName =
    !opts.force &&
    classifySraStoredName(row.displayName, row.sraId) === "real_firm_name";

  if (hasGoodName) return "skipped";

  const displayName = lookup.displayName!;
  const organisationName = lookup.organisationName ?? displayName;
  const tradingName = lookup.tradingName ?? row.tradingName;
  const firmName = lookup.firmName ?? row.firmName;
  const searchText = rebuildSearchText({
    sraId: row.sraId,
    displayName,
    organisationName,
    tradingName,
    existingSearchText: row.searchText,
    city: row.city,
    postcode: row.postcode,
    phone: lookup.phone ?? row.phone,
  });

  if (opts.dryRun) return "updated";

  await prisma.sraOrganisation.update({
    where: { id: orgId },
    data: {
      displayName,
      businessName: displayName,
      organisationName,
      tradingName,
      firmName: firmName || organisationName,
      searchText,
      phone: lookup.phone?.trim() || row.phone,
      sraProfileUrl: lookup.sourceUrl,
      nameRecoverySource: lookup.source,
      nameRecoverySourceUrl: lookup.sourceUrl,
      nameRecoveryFetchedAt: new Date(lookup.fetchedAt),
      nameRecoveryConfidence: lookup.confidence,
    },
  });

  return "updated";
}

export async function recoverSraOrganisationNameIfPlaceholder(
  entityId: string,
  opts?: { persist?: boolean; dryRun?: boolean },
): Promise<{ sraId: string; displayName: string } | null> {
  const { prisma } = await import("@/lib/db/prisma");
  const sraId = entityId.replace(/^sra:/i, "").replace(/^sra-/i, "");

  const row = await prisma.sraOrganisation.findFirst({
    where: { OR: [{ sraId }, { id: entityId }] },
  });
  if (!row) return null;

  if (!isPlaceholderSraDisplayName(row.displayName, row.sraId)) {
    return { sraId: row.sraId, displayName: row.displayName };
  }

  const lookup = await lookupSraRegisterWithDiagnostics(row.sraId);
  const result = lookup.result;
  if (!result?.displayName || result.rejectReason) return null;

  if (opts?.persist !== false && !opts?.dryRun) {
    await applySraRegisterLookupToRow(prisma, row.id, result, { force: false });
  }

  return { sraId: row.sraId, displayName: result.displayName };
}

export async function runSraNameBackfill(
  prisma: PrismaClient,
  opts: SraNameBackfillOptions = {},
): Promise<SraNameBackfillResult> {
  const limit = opts.limit ?? 100;
  const offset = opts.offset ?? 0;
  const onlyPlaceholders = opts.onlyPlaceholders !== false;
  const dryRun = opts.dryRun ?? false;

  const result: SraNameBackfillResult = {
    event: "sra_backfill_names",
    scanned: 0,
    lookedUp: 0,
    updated: 0,
    skippedGoodName: 0,
    rejectedAddressLike: 0,
    notFound: 0,
    failed: 0,
    dryRun,
  };

  let resumeAfter: string | undefined;
  if (opts.resume) {
    const cp = await loadCheckpoint();
    resumeAfter = cp.lastProcessedSraId;
    result.resumedFrom = resumeAfter;
  }

  const rows = await prisma.sraOrganisation.findMany({
    orderBy: { sraId: "asc" },
    skip: offset,
    take: limit + (resumeAfter ? 500 : 0),
    select: {
      id: true,
      sraId: true,
      displayName: true,
      businessName: true,
      organisationName: true,
    },
  });

  let skipping = Boolean(resumeAfter);
  const checkpoint: Checkpoint = { updated: 0, failed: 0 };

  for (const row of rows) {
    if (result.scanned >= limit) break;

    if (skipping) {
      if (row.sraId === resumeAfter) skipping = false;
      continue;
    }

    result.scanned++;

    if (onlyPlaceholders && !isPlaceholderSraDisplayName(row.displayName, row.sraId)) {
      result.skippedGoodName++;
      checkpoint.lastProcessedSraId = row.sraId;
      continue;
    }

    if (
      !opts.force &&
      classifySraStoredName(row.displayName, row.sraId) === "real_firm_name"
    ) {
      result.skippedGoodName++;
      checkpoint.lastProcessedSraId = row.sraId;
      continue;
    }

    try {
      result.lookedUp++;
      const diag = await lookupSraRegisterWithDiagnostics(row.sraId);
      if (opts.debug) {
        printLookupDiagnostics(diag);
      }

      const lookup = diag.result;
      if (!lookup) {
        result.notFound++;
      } else if (lookup.rejectReason === "address_like_name") {
        result.rejectedAddressLike++;
      } else if (lookup.rejectReason === "not_found" || !lookup.displayName) {
        result.notFound++;
      } else {
        const status = await applySraRegisterLookupToRow(prisma, row.id, lookup, {
          dryRun,
          force: opts.force,
        });
        if (status === "updated") result.updated++;
        else if (status === "skipped") result.skippedGoodName++;
        else if (status === "rejected") result.rejectedAddressLike++;
        else result.notFound++;
      }
    } catch (e) {
      result.failed++;
      checkpoint.failed++;
      if (opts.debug) {
        console.error(
          JSON.stringify({
            event: "sra_backfill_lookup_error",
            sraId: row.sraId,
            error: e instanceof Error ? e.message : String(e),
          }),
        );
      }
    }

    checkpoint.lastProcessedSraId = row.sraId;
    checkpoint.updated = result.updated;

    if (!dryRun && opts.resume) {
      await saveCheckpoint(checkpoint);
    }
  }

  return result;
}
