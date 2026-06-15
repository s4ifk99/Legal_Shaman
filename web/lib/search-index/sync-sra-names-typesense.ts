import type { Prisma, PrismaClient } from "@prisma/client";

import { LEGAL_ENTITIES_COLLECTION } from "@/lib/search-index/config";
import {
  logSraIndexDegraded,
  logSraIndexPage,
  shortDbErrorMessage,
  sraIndexPageSize,
  withDbRetry,
} from "@/lib/search-index/sra-index-page";
import {
  auditSraTitleRow,
  buildSraNamePatchRecord,
  chooseSraIndexTitle,
  sraTitleSourceInputFromOrg,
  type SraTitleAuditRow,
} from "@/lib/search-index/sra-title-source";
import {
  logTitleAuditSample,
  patchSraNamesInTypesense,
  type SraNamePatchResult,
} from "@/lib/search-index/typesense-sra-name-patch";

export type SyncSraNamesOptions = {
  limit?: number;
  debug?: boolean;
  forceDocumentUpdate?: boolean;
  skipTypesense?: boolean;
  resumeAfter?: string;
  pageSize?: number;
};

export type SyncSraNamesResult = {
  collection: string;
  orgsLoaded: number;
  patchesBuilt: number;
  titleReasons: Record<string, number>;
  typesense?: SraNamePatchResult;
  auditSample: SraTitleAuditRow[];
  degraded?: boolean;
  resumeAfter?: string | null;
};

const orgSelect = {
  sraId: true,
  displayName: true,
  organisationName: true,
  tradingName: true,
  firmName: true,
  businessName: true,
  searchText: true,
  rawPayload: true,
} as const;

type SraOrgNameRow = Prisma.SraOrganisationGetPayload<{ select: typeof orgSelect }>;

async function fetchSraOrgPage(
  prisma: PrismaClient,
  opts: { cursor?: string; take: number },
): Promise<SraOrgNameRow[]> {
  return withDbRetry("sraOrganisation.findMany", () =>
    prisma.sraOrganisation.findMany({
      where: opts.cursor ? { sraId: { gt: opts.cursor } } : {},
      orderBy: { sraId: "asc" },
      take: opts.take,
      select: orgSelect,
    }),
  );
}

async function loadFirmNames(
  prisma: PrismaClient,
  sraIds: string[],
): Promise<Map<string, string>> {
  if (!sraIds.length) return new Map();
  const firms = await withDbRetry("firm.findMany", () =>
    prisma.firm.findMany({
      where: { sraId: { in: sraIds } },
      select: { sraId: true, name: true },
    }),
  );
  return new Map(firms.filter((f) => f.sraId).map((f) => [f.sraId!, f.name]));
}

function mergeReasonCounts(into: Record<string, number>, from: Record<string, number>): void {
  for (const [reason, count] of Object.entries(from)) {
    into[reason] = (into[reason] ?? 0) + count;
  }
}

function buildPatchesForOrgs(
  orgs: SraOrgNameRow[],
  firmMap: Map<string, string>,
): {
  patches: Record<string, unknown>[];
  auditRows: SraTitleAuditRow[];
  reasons: Record<string, number>;
} {
  const patches: Record<string, unknown>[] = [];
  const auditRows: SraTitleAuditRow[] = [];
  const reasons: Record<string, number> = {};

  for (const org of orgs) {
    const firmName = firmMap.get(org.sraId) ?? null;
    const resolution = chooseSraIndexTitle(sraTitleSourceInputFromOrg(org, firmName));
    reasons[resolution.reason] = (reasons[resolution.reason] ?? 0) + 1;

    patches.push(
      buildSraNamePatchRecord({
        entityId: `sra:${org.sraId}`,
        title: resolution.title,
      }),
    );
    auditRows.push(auditSraTitleRow(org, firmName));
  }

  return { patches, auditRows, reasons };
}

export async function buildSraNamePatches(
  prisma: PrismaClient,
  options?: { limit?: number; resumeAfter?: string; pageSize?: number },
): Promise<{ patches: Record<string, unknown>[]; auditRows: SraTitleAuditRow[]; reasons: Record<string, number> }> {
  const pageSize = options?.pageSize ?? sraIndexPageSize();
  const hardLimit = options?.limit;
  let cursor = options?.resumeAfter?.trim() || undefined;
  const patches: Record<string, unknown>[] = [];
  const auditRows: SraTitleAuditRow[] = [];
  const reasons: Record<string, number> = {};
  let loaded = 0;

  while (true) {
    const remaining = hardLimit != null ? hardLimit - loaded : pageSize;
    if (hardLimit != null && remaining <= 0) break;
    const take = hardLimit != null ? Math.min(pageSize, remaining) : pageSize;

    const orgs = await fetchSraOrgPage(prisma, { cursor, take });
    if (!orgs.length) break;

    const firmMap = await loadFirmNames(prisma, orgs.map((o) => o.sraId));
    const batch = buildPatchesForOrgs(orgs, firmMap);
    patches.push(...batch.patches);
    auditRows.push(...batch.auditRows);
    mergeReasonCounts(reasons, batch.reasons);

    loaded += orgs.length;
    cursor = orgs[orgs.length - 1]!.sraId;
    if (orgs.length < take) break;
  }

  return { patches, auditRows, reasons };
}

export async function syncSraNamesToTypesense(
  prisma: PrismaClient,
  client: InstanceType<typeof import("typesense").default.Client>,
  options?: SyncSraNamesOptions,
): Promise<SyncSraNamesResult> {
  const titleReasons: Record<string, number> = {};
  const auditSample: SraTitleAuditRow[] = [];
  let orgsLoaded = 0;
  let patchesBuilt = 0;
  let typesense: SraNamePatchResult | undefined;
  const typesenseErrors: string[] = [];
  let typesenseMethod: SraNamePatchResult["method"] | undefined;
  let cursor = options?.resumeAfter?.trim() || undefined;
  const hardLimit = options?.limit;
  const pageSize = options?.pageSize ?? sraIndexPageSize();
  let loggedSample = false;
  let pageIndex = 0;
  let lastSuccessfulSraId: string | null = cursor ?? null;

  while (true) {
    const remaining = hardLimit != null ? hardLimit - orgsLoaded : pageSize;
    if (hardLimit != null && remaining <= 0) break;

    const take = hardLimit != null ? Math.min(pageSize, remaining) : pageSize;
    pageIndex++;
    const pageStarted = Date.now();
    let rowsLoaded = 0;
    let firstSraId: string | null = null;
    let lastSraId: string | null = null;
    let pagePatchesBuilt = 0;
    let pageDocsUpserted = 0;

    try {
      const orgs = await fetchSraOrgPage(prisma, { cursor, take });
      if (!orgs.length) break;

      rowsLoaded = orgs.length;
      firstSraId = orgs[0]!.sraId;
      lastSraId = orgs[orgs.length - 1]!.sraId;

      const firmMap = await loadFirmNames(prisma, orgs.map((o) => o.sraId));
      const { patches, auditRows, reasons } = buildPatchesForOrgs(orgs, firmMap);
      mergeReasonCounts(titleReasons, reasons);
      orgsLoaded += orgs.length;
      patchesBuilt += patches.length;
      pagePatchesBuilt = patches.length;
      lastSuccessfulSraId = lastSraId;
      cursor = lastSraId;

      if (options?.debug && !loggedSample) {
        logTitleAuditSample(auditRows, 5);
        console.info(
          JSON.stringify({
            event: "sra_names_sync_plan",
            collection: LEGAL_ENTITIES_COLLECTION,
            batchSize: orgs.length,
            orgsLoaded,
            patchesBuilt,
            titleReasons,
            avoidsFullDocumentBuild: true,
            patchFields: patches[0] ? Object.keys(patches[0]) : [],
          }),
        );
        loggedSample = true;
      }

      if (auditSample.length < 10) {
        auditSample.push(...auditRows.slice(0, 10 - auditSample.length));
      }

      if (!options?.skipTypesense && patches.length) {
        const batchResult = await patchSraNamesInTypesense(client, patches, {
          debug: options?.debug && orgsLoaded <= pageSize,
          forceDocumentUpdate: options?.forceDocumentUpdate,
        });
        typesenseMethod = batchResult.method;
        typesenseErrors.push(...batchResult.errors);
        pageDocsUpserted = batchResult.documentsPatched;
        typesense = {
          documentsPatched: (typesense?.documentsPatched ?? 0) + batchResult.documentsPatched,
          errors: typesenseErrors,
          method: typesenseMethod,
          progress: batchResult.progress,
        };
      }

      logSraIndexPage({
        event: "search_index_sra_page",
        pageIndex,
        rowsLoaded,
        firstSraId,
        lastSraId,
        docsBuilt: pagePatchesBuilt,
        docsUpserted: pageDocsUpserted,
        elapsedMs: Date.now() - pageStarted,
      });

      if (orgs.length < take) break;
    } catch (err) {
      const error = shortDbErrorMessage(err);
      logSraIndexDegraded({
        event: "search_index_sra_degraded",
        degraded: true,
        resumeAfter: lastSuccessfulSraId,
        lastSuccessfulSraId,
        pageIndex,
        error,
        documentsBuilt: patchesBuilt,
        documentsUpserted: typesense?.documentsPatched ?? 0,
      });
      return {
        collection: LEGAL_ENTITIES_COLLECTION,
        orgsLoaded,
        patchesBuilt,
        titleReasons,
        typesense,
        auditSample,
        degraded: true,
        resumeAfter: lastSuccessfulSraId,
      };
    }
  }

  return {
    collection: LEGAL_ENTITIES_COLLECTION,
    orgsLoaded,
    patchesBuilt,
    titleReasons,
    typesense,
    auditSample,
  };
}

export async function auditSraTitleSources(
  prisma: PrismaClient,
  limit = 25,
): Promise<SraTitleAuditRow[]> {
  const { auditRows } = await buildSraNamePatches(prisma, { limit });
  return auditRows;
}
