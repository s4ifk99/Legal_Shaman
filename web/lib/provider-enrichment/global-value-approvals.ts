import { prisma } from "@/lib/db/prisma";
import { normalizeForDedup } from "@/lib/provider-crawler/admin-review";
import { bulkSetExtractedFieldStatus } from "@/lib/provider-crawler/review-queue";

type CacheEntry = { displayValue: string; approvedAt: number };

const CACHE_TTL_MS = 5 * 60 * 1000;
let cacheLoadedAt = 0;
const approvalCache = new Map<string, CacheEntry>();

function cacheKey(fieldName: string, normalizedValue: string): string {
  return `${fieldName}::${normalizedValue}`;
}

export function normalizeGlobalValueKey(fieldName: string, value: string): string {
  return normalizeForDedup(fieldName, value);
}

async function refreshCacheIfStale(): Promise<void> {
  if (Date.now() - cacheLoadedAt < CACHE_TTL_MS && approvalCache.size > 0) return;
  try {
    const rows = await prisma.providerGlobalValueApproval.findMany({
      select: { fieldName: true, normalizedValue: true, displayValue: true, approvedAt: true },
    });
    approvalCache.clear();
    for (const r of rows) {
      approvalCache.set(cacheKey(r.fieldName, r.normalizedValue), {
        displayValue: r.displayValue,
        approvedAt: r.approvedAt.getTime(),
      });
    }
    cacheLoadedAt = Date.now();
  } catch {
    /* table may not exist yet — cache stays empty */
  }
}

export function invalidateGlobalApprovalCache(): void {
  cacheLoadedAt = 0;
  approvalCache.clear();
}

export async function isGloballyApproved(fieldName: string, value: string): Promise<boolean> {
  await refreshCacheIfStale();
  const aliases =
    fieldName === "practiceAreaSlugs" || fieldName === "practice_areas"
      ? ["practice_areas", "practiceAreaSlugs"]
      : fieldName === "contactPageUrl"
        ? ["contact_page", "contactPageUrl"]
        : [fieldName];
  const normalized = normalizeGlobalValueKey(
    aliases[0] ?? fieldName,
    value,
  );
  return aliases.some((fn) => approvalCache.has(cacheKey(fn, normalized)));
}

export async function registerGlobalValueApproval(args: {
  fieldName: string;
  displayValue: string;
  normalizedValue: string;
  approvedBy?: string;
}): Promise<boolean> {
  try {
    await prisma.providerGlobalValueApproval.upsert({
      where: {
        fieldName_normalizedValue: {
          fieldName: args.fieldName,
          normalizedValue: args.normalizedValue,
        },
      },
      create: {
        fieldName: args.fieldName,
        normalizedValue: args.normalizedValue,
        displayValue: args.displayValue,
        approvedBy: args.approvedBy,
      },
      update: {
        displayValue: args.displayValue,
        approvedBy: args.approvedBy,
        approvedAt: new Date(),
      },
    });
    approvalCache.set(cacheKey(args.fieldName, args.normalizedValue), {
      displayValue: args.displayValue,
      approvedAt: Date.now(),
    });
    cacheLoadedAt = Date.now();
    return true;
  } catch {
    return false;
  }
}

export async function findPendingIdsForGlobalValue(
  fieldName: string,
  normalizedValue: string,
  limit = 5000,
): Promise<string[]> {
  try {
    const rows = await prisma.providerExtractedField.findMany({
      where: {
        fieldName,
        status: { in: ["pending_review", "audit_review"] },
      },
      select: { id: true, extractedValue: true },
      take: limit,
    });
    return rows
      .filter((r) => normalizeGlobalValueKey(fieldName, r.extractedValue) === normalizedValue)
      .map((r) => r.id);
  } catch {
    return [];
  }
}

/** Register global approval and approve all matching pending rows (including off-page). */
export async function approveGlobalValue(args: {
  fieldName: string;
  displayValue: string;
  normalizedValue: string;
  seedIds?: string[];
  approvedBy?: string;
}): Promise<{ registered: boolean; approved: string[]; failed: string[] }> {
  const registered = await registerGlobalValueApproval({
    fieldName: args.fieldName,
    displayValue: args.displayValue,
    normalizedValue: args.normalizedValue,
    approvedBy: args.approvedBy,
  });

  const fromDb = await findPendingIdsForGlobalValue(args.fieldName, args.normalizedValue);
  const ids = [...new Set([...(args.seedIds ?? []), ...fromDb])];
  const { ok, failed } = await bulkSetExtractedFieldStatus(ids, "approved");
  return { registered, approved: ok, failed };
}

export async function rejectGlobalValue(args: {
  fieldName: string;
  normalizedValue: string;
  seedIds?: string[];
}): Promise<{ rejected: string[]; failed: string[] }> {
  const fromDb = await findPendingIdsForGlobalValue(args.fieldName, args.normalizedValue);
  const ids = [...new Set([...(args.seedIds ?? []), ...fromDb])];
  const { ok, failed } = await bulkSetExtractedFieldStatus(ids, "rejected");
  return { rejected: ok, failed };
}
