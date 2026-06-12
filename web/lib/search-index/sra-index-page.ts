import {
  isDbTimeoutError,
  shortDbErrorMessage,
  withDbRetry,
} from "@/lib/sra/missing-identity-recovery/load-organisation-batch";

export { isDbTimeoutError, shortDbErrorMessage, withDbRetry };

export function sraIndexPageSize(): number {
  const n = Number(process.env.SEARCH_INDEX_SRA_PAGE_SIZE ?? "500");
  if (!Number.isFinite(n) || n < 1) return 500;
  return Math.floor(n);
}

export type SraIndexPageLog = {
  event: "search_index_sra_page";
  pageIndex: number;
  rowsLoaded: number;
  firstSraId: string | null;
  lastSraId: string | null;
  docsBuilt: number;
  docsUpserted: number;
  elapsedMs: number;
};

export function logSraIndexPage(log: SraIndexPageLog): void {
  console.info(JSON.stringify(log));
}

export type SraIndexDegradedOutput = {
  event: "search_index_sra_degraded";
  degraded: true;
  resumeAfter: string | null;
  lastSuccessfulSraId: string | null;
  pageIndex: number;
  error: string;
  documentsBuilt: number;
  documentsUpserted: number;
};

export function logSraIndexDegraded(output: SraIndexDegradedOutput): void {
  console.error(JSON.stringify(output));
}
