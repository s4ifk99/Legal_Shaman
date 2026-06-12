import { Prisma, type PrismaClient } from "@prisma/client";

import type { SraV2Record } from "@/lib/search/sra-document";

export type SraCoverageMetrics = {
  total: number;
  withPhone: number;
  withWebsite: number;
  withEmail: number;
  withTradingNames: number;
  withPreviousNames: number;
  withWorkArea: number;
  withAuthorisationStatus: number;
  withOffices: number;
  withRawPayload: number;
  placeholder: number;
  placeholderPct: number;
};

function pct(n: number, total: number): number {
  return total ? Math.round((n / total) * 1000) / 10 : 0;
}

export function metricsFromV2Batch(docs: SraV2Record[]): SraCoverageMetrics {
  let withPhone = 0;
  let withWebsite = 0;
  let withEmail = 0;
  let withTradingNames = 0;
  let withPreviousNames = 0;
  let withWorkArea = 0;
  let withAuthorisationStatus = 0;
  let withOffices = 0;
  let withRawPayload = 0;
  let placeholder = 0;

  for (const d of docs) {
    if (d.phone?.trim()) withPhone++;
    if (d.website?.trim()) withWebsite++;
    if (d.email?.trim()) withEmail++;
    if (d.tradingNames.length) withTradingNames++;
    if (d.previousNames.length) withPreviousNames++;
    if (d.workArea.length) withWorkArea++;
    if (d.authorisationStatus?.trim()) withAuthorisationStatus++;
    if (d.offices.length) withOffices++;
    if (d.rawPayload && Object.keys(d.rawPayload).length) withRawPayload++;
    if (/^SRA organisation\s/i.test(d.displayName)) placeholder++;
  }

  const total = docs.length;
  return {
    total,
    withPhone,
    withWebsite,
    withEmail,
    withTradingNames,
    withPreviousNames,
    withWorkArea,
    withAuthorisationStatus,
    withOffices,
    withRawPayload,
    placeholder,
    placeholderPct: pct(placeholder, total),
  };
}

export async function collectSraDbCoverage(
  prisma: PrismaClient,
  where?: { sraId?: { in: string[] } },
): Promise<SraCoverageMetrics> {
  const baseWhere = where ?? {};
  const total = await prisma.sraOrganisation.count({ where: baseWhere });
  const withPhone = await prisma.sraOrganisation.count({
    where: { ...baseWhere, phone: { not: "" } },
  });
  const withWebsite = await prisma.sraOrganisation.count({
    where: { ...baseWhere, website: { not: "" } },
  });
  const withEmail = await prisma.sraOrganisation.count({
    where: { ...baseWhere, email: { not: "" } },
  });
  const withAuthorisationStatus = await prisma.sraOrganisation.count({
    where: { ...baseWhere, authorisationStatus: { not: "" } },
  });
  const placeholder = await prisma.sraOrganisation.count({
    where: { ...baseWhere, displayName: { startsWith: "SRA organisation" } },
  });
  const withTradingNames = await prisma.sraOrganisation.count({
    where: { ...baseWhere, tradingNames: { not: Prisma.DbNull } },
  });
  const withPreviousNames = await prisma.sraOrganisation.count({
    where: { ...baseWhere, previousNames: { not: Prisma.DbNull } },
  });
  const withWorkArea = await prisma.sraOrganisation.count({
    where: { ...baseWhere, workArea: { not: Prisma.DbNull } },
  });
  const withOffices = await prisma.sraOrganisation.count({
    where: { ...baseWhere, offices: { not: Prisma.DbNull } },
  });
  const withRawPayload = await prisma.sraOrganisation.count({
    where: { ...baseWhere, rawPayload: { not: Prisma.DbNull } },
  });

  return {
    total,
    withPhone,
    withWebsite,
    withEmail,
    withTradingNames,
    withPreviousNames,
    withWorkArea,
    withAuthorisationStatus,
    withOffices,
    withRawPayload,
    placeholder,
    placeholderPct: pct(placeholder, total),
  };
}

export function formatCoverageComparison(
  before: SraCoverageMetrics,
  after: SraCoverageMetrics,
): Record<string, unknown> {
  const delta = (field: keyof Omit<SraCoverageMetrics, "placeholderPct">) => ({
    before: before[field],
    after: after[field],
    delta: after[field] - before[field],
  });

  return {
    total: delta("total"),
    withPhone: delta("withPhone"),
    withWebsite: delta("withWebsite"),
    withEmail: delta("withEmail"),
    withTradingNames: delta("withTradingNames"),
    withPreviousNames: delta("withPreviousNames"),
    withWorkArea: delta("withWorkArea"),
    withAuthorisationStatus: delta("withAuthorisationStatus"),
    withOffices: delta("withOffices"),
    withRawPayload: delta("withRawPayload"),
    placeholderDisplayNames: {
      before: before.placeholder,
      after: after.placeholder,
      delta: after.placeholder - before.placeholder,
      beforePct: before.placeholderPct,
      afterPct: after.placeholderPct,
    },
  };
}
