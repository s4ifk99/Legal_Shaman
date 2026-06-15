import type { Prisma, PrismaClient } from "@prisma/client";
import {
  classifySraStoredName,
  isPlaceholderSraDisplayName,
} from "@/lib/sra/sra-name-quality";
import {
  markStartupStage,
  type StartupTiming,
} from "@/lib/sra/missing-identity-recovery/startup-timing";

export const SRA_RECOVERY_ORG_SELECT = {
  id: true,
  sraId: true,
  displayName: true,
  organisationName: true,
  tradingName: true,
  firmName: true,
  businessName: true,
  searchText: true,
  postcode: true,
  city: true,
  county: true,
  country: true,
  phone: true,
  normalizedAddress: true,
} satisfies Prisma.SraOrganisationSelect;

export type SraOrgRecoveryRow = Prisma.SraOrganisationGetPayload<{
  select: typeof SRA_RECOVERY_ORG_SELECT;
}>;

export type LoadBatchQueryTiming = {
  queryStart: string;
  queryCompleted?: string;
  rowsLoaded: number;
  elapsedMs?: number;
  pagesFetched?: number;
};

export const BATCH_SELECTION_QUERY_TIMEOUT_MS = Number(
  process.env.SRA_IDENTITY_BATCH_QUERY_TIMEOUT_MS ?? "30000",
);

export type LoadOrganisationBatchOptions = {
  sraId?: string;
  take: number;
  resumeAfter?: string;
  onlyPlaceholders?: boolean;
  onlyAddressLike?: boolean;
  dbPageSize?: number;
  maxScanPages?: number;
  startupTiming?: StartupTiming;
  queryTimeoutMs?: number;
};

export function batchSelectionQueryTimeoutError(timeoutMs: number): Error {
  return Object.assign(
    new Error(`batch selection query timed out after ${timeoutMs}ms`),
    { code: "ETIMEDOUT" },
  );
}

export async function withBatchQueryTimeout<T>(
  promise: Promise<T>,
  timeoutMs = BATCH_SELECTION_QUERY_TIMEOUT_MS,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(batchSelectionQueryTimeoutError(timeoutMs)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export type LoadOrganisationBatchResult = {
  rows: SraOrgRecoveryRow[];
  timing: LoadBatchQueryTiming;
  degraded: boolean;
  loadError?: string;
};

function dbPageSize(): number {
  return Number(process.env.SRA_IDENTITY_DB_PAGE_SIZE ?? "5");
}

function dbRetryConfig(): { maxAttempts: number; baseDelayMs: number } {
  return {
    maxAttempts: Number(process.env.SRA_IDENTITY_DB_RETRY_ATTEMPTS ?? "3"),
    baseDelayMs: Number(process.env.SRA_IDENTITY_DB_RETRY_BASE_MS ?? "750"),
  };
}

export function isDbTimeoutError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = "code" in err ? String((err as { code?: string }).code) : "";
  const msg = err instanceof Error ? err.message : String(err);
  return (
    code === "ETIMEDOUT" ||
    /ETIMEDOUT/i.test(msg) ||
    /timed?\s*out/i.test(msg) ||
    /connection terminated/i.test(msg) ||
    /statement timeout/i.test(msg) ||
    /canceling statement/i.test(msg) ||
    /P1008/i.test(msg) ||
    /P2024/i.test(msg) ||
    /Unable to start a transaction/i.test(msg)
  );
}

export function shortDbErrorMessage(err: unknown): string {
  if (isDbTimeoutError(err)) return "ETIMEDOUT";
  if (err instanceof Error) return err.message.split("\n")[0]!.slice(0, 200);
  return String(err).slice(0, 200);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function withDbRetry<T>(
  label: string,
  fn: () => Promise<T>,
  opts?: { maxAttempts?: number; baseDelayMs?: number },
): Promise<T> {
  const defaults = dbRetryConfig();
  const maxAttempts = opts?.maxAttempts ?? defaults.maxAttempts;
  let delayMs = opts?.baseDelayMs ?? defaults.baseDelayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isDbTimeoutError(err) || attempt >= maxAttempts) throw err;
      await sleep(delayMs);
      delayMs = Math.min(delayMs * 2, 15_000);
    }
  }
  throw new Error(`${label}: retry exhausted`);
}

function primaryDisplayName(row: SraOrgRecoveryRow): string {
  return (
    row.displayName.trim() ||
    row.organisationName.trim() ||
    row.businessName.trim() ||
    row.firmName.trim()
  );
}

export function rowMatchesRecoveryFilters(
  row: SraOrgRecoveryRow,
  opts: Pick<LoadOrganisationBatchOptions, "onlyPlaceholders" | "onlyAddressLike">,
): boolean {
  const name = primaryDisplayName(row);

  if (opts.onlyAddressLike) {
    return classifySraStoredName(name, row.sraId) === "address_like_name";
  }

  if (opts.onlyPlaceholders !== false) {
    return isPlaceholderSraDisplayName(name, row.sraId);
  }

  return true;
}

function buildKeysetWhere(
  opts: LoadOrganisationBatchOptions,
  cursorAfter?: string,
): Prisma.SraOrganisationWhereInput {
  const where: Prisma.SraOrganisationWhereInput = {};

  if (cursorAfter) {
    where.sraId = { gt: cursorAfter };
  }

  if (opts.onlyAddressLike) {
    return where;
  }

  if (opts.onlyPlaceholders !== false) {
    where.displayName = { startsWith: "SRA organisation" };
  }

  return where;
}

async function fetchOrgPage(
  prisma: PrismaClient,
  opts: LoadOrganisationBatchOptions,
  cursorAfter: string | undefined,
  pageSize: number,
  pageIndex: number,
): Promise<SraOrgRecoveryRow[]> {
  const timeoutMs = opts.queryTimeoutMs ?? BATCH_SELECTION_QUERY_TIMEOUT_MS;
  markStartupStage(opts.startupTiming, "beforePaginationQuery", {
    pageIndex,
    pageSize,
    cursorAfter: cursorAfter ?? null,
    timeoutMs,
  });

  const started = Date.now();
  try {
    return await withBatchQueryTimeout(
      withDbRetry("sraOrganisation.findMany", () =>
        prisma.sraOrganisation.findMany({
          where: buildKeysetWhere(opts, cursorAfter),
          orderBy: { sraId: "asc" },
          take: pageSize,
          select: SRA_RECOVERY_ORG_SELECT,
        }),
      ),
      timeoutMs,
    );
  } finally {
    markStartupStage(opts.startupTiming, "afterPaginationQuery", {
      pageIndex,
      elapsedMs: Date.now() - started,
    });
  }
}

async function loadSingleSra(
  prisma: PrismaClient,
  sraId: string,
  opts: LoadOrganisationBatchOptions,
): Promise<SraOrgRecoveryRow[]> {
  const id = sraId.replace(/^sra:/i, "").trim();
  const timeoutMs = opts.queryTimeoutMs ?? BATCH_SELECTION_QUERY_TIMEOUT_MS;

  markStartupStage(opts.startupTiming, "beforePaginationQuery", {
    mode: "single",
    sraId: id,
    timeoutMs,
  });

  const started = Date.now();
  try {
    const row = await withBatchQueryTimeout(
      withDbRetry("sraOrganisation.findFirst", () =>
        prisma.sraOrganisation.findFirst({
          where: { sraId: id },
          select: SRA_RECOVERY_ORG_SELECT,
        }),
      ),
      timeoutMs,
    );
    return row ? [row] : [];
  } finally {
    markStartupStage(opts.startupTiming, "afterPaginationQuery", {
      mode: "single",
      elapsedMs: Date.now() - started,
    });
  }
}

/**
 * Keyset-paginated, column-minimal load for missing-identity recovery.
 * Applies take before recovery work; uses small DB pages with retry on ETIMEDOUT.
 */
export async function loadOrganisationBatch(
  prisma: PrismaClient,
  opts: LoadOrganisationBatchOptions,
): Promise<LoadOrganisationBatchResult> {
  const queryStart = new Date().toISOString();
  const started = Date.now();
  const take = Math.max(1, opts.take);
  const pageSize = Math.max(1, Math.min(opts.dbPageSize ?? dbPageSize(), take));
  const maxScanPages =
    opts.maxScanPages ??
    (opts.onlyAddressLike ? Math.max(40, take * 8) : Math.max(8, Math.ceil(take / pageSize) + 2));

  try {
    if (opts.sraId) {
      const rows = await loadSingleSra(prisma, opts.sraId, opts);
      const elapsedMs = Date.now() - started;
      return {
        rows,
        degraded: false,
        timing: {
          queryStart,
          queryCompleted: new Date().toISOString(),
          rowsLoaded: rows.length,
          elapsedMs,
          pagesFetched: 1,
        },
      };
    }

    const matched: SraOrgRecoveryRow[] = [];
    let cursor = opts.resumeAfter?.trim() || undefined;
    let pagesFetched = 0;

    while (matched.length < take && pagesFetched < maxScanPages) {
      const page = await fetchOrgPage(prisma, opts, cursor, pageSize, pagesFetched);
      pagesFetched++;
      if (page.length === 0) break;

      for (const row of page) {
        if (!rowMatchesRecoveryFilters(row, opts)) continue;
        matched.push(row);
        if (matched.length >= take) break;
      }

      cursor = page[page.length - 1]!.sraId;
      if (page.length < pageSize) break;
    }

    const elapsedMs = Date.now() - started;
    return {
      rows: matched,
      degraded: false,
      timing: {
        queryStart,
        queryCompleted: new Date().toISOString(),
        rowsLoaded: matched.length,
        elapsedMs,
        pagesFetched,
      },
    };
  } catch (err) {
    const elapsedMs = Date.now() - started;
    return {
      rows: [],
      degraded: true,
      loadError: shortDbErrorMessage(err),
      timing: {
        queryStart,
        queryCompleted: new Date().toISOString(),
        rowsLoaded: 0,
        elapsedMs,
      },
    };
  }
}
