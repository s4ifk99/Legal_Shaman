import "server-only";

import { prisma } from "@/lib/db/prisma";
import { collectIndexBalanceReport } from "@/lib/search-index/index-balance-diagnostics";

export type ProviderCoverageReport = {
  indexBalance: Awaited<ReturnType<typeof collectIndexBalanceReport>>;
  firmsMissingWebsite: number;
  lawyersTotal: number;
  pendingEnrichmentCount: number;
  weakGeocodeSample: { city: string | null; postcode: string | null; count: number }[];
};

export async function analyzeProviderCoverage(): Promise<ProviderCoverageReport | null> {
  const indexBalance = await collectIndexBalanceReport();
  if (!indexBalance) return null;

  const [firmsMissingWebsite, lawyersTotal, pendingEnrichmentCount] = await Promise.all([
    prisma.firm.count({ where: { OR: [{ website: null }, { website: "" }] } }).catch(() => 0),
    prisma.lawyer.count().catch(() => 0),
    prisma.providerEnrichment.count({ where: { status: "pending_review" } }).catch(() => 0),
  ]);

  const geo = await prisma.geocodedLocation
    .groupBy({
      by: ["city", "postcode"],
      _count: { id: true },
      where: { OR: [{ latitude: null }, { longitude: null }] },
      orderBy: { _count: { id: "desc" } },
      take: 15,
    })
    .catch(() => []);

  const weakGeocodeSample = geo.map((g) => ({
    city: g.city,
    postcode: g.postcode,
    count: g._count.id,
  }));

  return {
    indexBalance,
    firmsMissingWebsite,
    lawyersTotal,
    pendingEnrichmentCount,
    weakGeocodeSample,
  };
}
