import { fetchAllListings } from "@/lib/data";
import { prisma } from "@/lib/db/prisma";
import { lawyerInclude } from "@/lib/lawyers/lawyer-include";
import {
  buildCuratedDocuments,
  buildLegalAidDocuments,
  buildLawyerDocuments,
  buildProBonoDocuments,
  buildSingleSraDocument,
  documentToTypesenseRecord,
} from "@/lib/search-index/build-legal-entity-doc";
import { LEGAL_ENTITIES_COLLECTION } from "@/lib/search-index/config";
import { applyProviderIntelligence, loadEnrichmentCache } from "@/lib/search-index/apply-provider-intelligence";
import { enrichLegalEntityForIndex } from "@/lib/search-index/enrich-legal-entity-index";
import { ensureLegalEntitiesCollection } from "@/lib/search-index/typesense-legal-entities-index";
import type { EntitySource } from "@/lib/ops/indexing-jobs";
import type { LegalEntityDocument } from "@/lib/search-index/types";
import { buildTypesenseListingsClientFromEnv } from "@/lib/search/typesense-listings-client";

export type IncrementalIndexResult =
  | { ok: true; entityId: string; title: string }
  | { ok: false; entityId: string; error: string };

async function buildSraDocByEntityId(entityId: string): Promise<LegalEntityDocument | null> {
  return buildSingleSraDocument(entityId, { skipGeo: true });
}

async function buildCuratedDocByEntityId(entityId: string): Promise<LegalEntityDocument | null> {
  const rawId = entityId.replace(/^curated:/, "");
  const listing = fetchAllListings().find((l) => l.id === rawId);
  if (!listing) return null;
  const docs = await buildCuratedDocuments();
  return docs.find((d) => d.id === entityId || d.rawSourceId === rawId) ?? null;
}

async function buildLegalAidDocByEntityId(entityId: string): Promise<LegalEntityDocument | null> {
  const rawId = entityId.replace(/^legal_aid:/, "");
  const docs = await buildLegalAidDocuments();
  return docs.find((d) => d.id === entityId || d.rawSourceId === rawId) ?? null;
}

async function buildProBonoDocByEntityId(entityId: string): Promise<LegalEntityDocument | null> {
  const docs = await buildProBonoDocuments();
  return docs.find((d) => d.id === entityId) ?? null;
}

async function buildLawyerDocByEntityId(entityId: string): Promise<LegalEntityDocument | null> {
  const lawyerId = entityId.replace(/^lawyer:/, "");
  const lawyer = await prisma.lawyer.findUnique({
    where: { id: lawyerId },
    include: lawyerInclude,
  });
  if (!lawyer) return null;
  const docs = await buildLawyerDocuments();
  return docs.find((d) => d.id === entityId || d.rawSourceId === lawyerId) ?? null;
}

export async function buildEntityDocument(
  entityId: string,
  source: EntitySource,
): Promise<LegalEntityDocument | null> {
  switch (source) {
    case "sra":
      return buildSraDocByEntityId(entityId);
    case "curated":
      return buildCuratedDocByEntityId(entityId);
    case "legal_aid":
      return buildLegalAidDocByEntityId(entityId);
    case "probono":
      return buildProBonoDocByEntityId(entityId);
    case "lawyers":
      return buildLawyerDocByEntityId(entityId);
    default:
      return null;
  }
}

export async function upsertEntityToTypesense(doc: LegalEntityDocument): Promise<void> {
  const client = buildTypesenseListingsClientFromEnv({ connectionTimeoutSeconds: 60 });
  if (!client) {
    throw new Error("TYPESENSE_HOST and TYPESENSE_API_KEY required");
  }
  await ensureLegalEntitiesCollection(client);
  await loadEnrichmentCache();
  const enriched = enrichLegalEntityForIndex(await applyProviderIntelligence(doc));
  const record = documentToTypesenseRecord(enriched);
  const importRes = (await client
    .collections(LEGAL_ENTITIES_COLLECTION)
    .documents()
    .import([record], { action: "upsert" })) as { success?: boolean; error?: string }[];
  const line = importRes[0];
  if (!line?.success) {
    throw new Error(line?.error ?? "Typesense upsert failed");
  }
}

export async function verifyEntityInTypesense(entityId: string): Promise<boolean> {
  const client = buildTypesenseListingsClientFromEnv();
  if (!client) return false;
  try {
    await client.collections(LEGAL_ENTITIES_COLLECTION).documents(entityId).retrieve();
    return true;
  } catch {
    return false;
  }
}

export async function indexSingleProvider(
  entityId: string,
  source: EntitySource,
): Promise<IncrementalIndexResult> {
  const doc = await buildEntityDocument(entityId, source);
  if (!doc) {
    return { ok: false, entityId, error: `Entity not found: ${entityId} (${source})` };
  }
  try {
    await upsertEntityToTypesense(doc);
    const verified = await verifyEntityInTypesense(doc.id);
    if (!verified) {
      return { ok: false, entityId: doc.id, error: "Typesense upsert succeeded but document not found on verify" };
    }
    return { ok: true, entityId: doc.id, title: doc.title };
  } catch (e) {
    return {
      ok: false,
      entityId,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
