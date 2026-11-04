import type { PublishedPriceRecord } from "@/lib/legal-search/evidence/types";

/**
 * A record is used only when every required field is present and sane.
 */
export function isAcceptablePublishedPrice(
  record: Partial<PublishedPriceRecord> | null | undefined,
): record is PublishedPriceRecord {
  if (!record) return false;
  if (typeof record.resultId !== "string" || !record.resultId.trim()) return false;
  if (typeof record.providerName !== "string" || !record.providerName.trim()) return false;
  if (typeof record.service !== "string" || !record.service.trim()) return false;
  if (record.currency !== "GBP") return false;
  const minPence = record.minPence;
  const maxPence = record.maxPence;
  if (typeof minPence !== "number" || typeof maxPence !== "number") return false;
  if (!Number.isFinite(minPence) || !Number.isFinite(maxPence)) return false;
  if (minPence < 0 || maxPence < 0 || minPence > maxPence) return false;
  if (typeof record.checkedOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(record.checkedOn)) {
    return false;
  }
  if (Number.isNaN(Date.parse(record.checkedOn))) return false;
  if (typeof record.sourceUrl !== "string") return false;
  try {
    const url = new URL(record.sourceUrl);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
