import { buildSraDocuments } from "@/lib/search-index/build-legal-entity-doc";
import { applyProviderIntelligence, loadEnrichmentCache } from "@/lib/search-index/apply-provider-intelligence";
import { enrichLegalEntityForIndex } from "@/lib/search-index/enrich-legal-entity-index";
import type { LegalEntityDocument } from "@/lib/search-index/types";
import { loadAllApprovedEnrichments } from "@/lib/provider-enrichment/review-queue";
import type { ProviderEnrichment } from "@/lib/provider-enrichment/types";
import { prisma } from "@/lib/db/prisma";

export function parseCliLimit(argv: string[], defaultLimit = 100): number {
  const flag = argv.find((a) => a.startsWith("--limit="));
  return Number(flag?.split("=")[1] ?? defaultLimit);
}

export async function loadSraIndexDocuments(opts?: {
  take?: number;
  skipGeo?: boolean;
}): Promise<LegalEntityDocument[]> {
  await loadEnrichmentCache();
  const raw = await buildSraDocuments({
    take: opts?.take ?? 50000,
    skipGeo: opts?.skipGeo ?? true,
  });
  const docs: LegalEntityDocument[] = [];
  for (const d of raw) {
    const intel = await applyProviderIntelligence(d);
    docs.push(enrichLegalEntityForIndex(intel));
  }
  return docs;
}

export async function loadEnrichmentMap(): Promise<Map<string, ProviderEnrichment[]>> {
  const rows = await loadAllApprovedEnrichments();
  const all = await prisma.providerEnrichment
    .findMany({
      where: { status: { in: ["approved", "auto_approved", "pending_review"] } },
    })
    .catch(() => []);
  const map = new Map<string, ProviderEnrichment[]>();
  for (const row of [...rows, ...all.map((r) => ({
    id: r.id,
    entityId: r.entityId,
    entityType: r.entityType,
    fieldName: r.fieldName,
    extractedValue: r.extractedValue,
    confidence: r.confidence,
    sourceUrl: r.sourceUrl ?? undefined,
    sourceType: r.sourceType as ProviderEnrichment["sourceType"],
    extractionMethod: r.extractionMethod as ProviderEnrichment["extractionMethod"],
    status: r.status as ProviderEnrichment["status"],
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }))]) {
    const list = map.get(row.entityId) ?? [];
    if (!list.some((x) => x.id === row.id)) list.push(row);
    map.set(row.entityId, list);
  }
  return map;
}
