import {
  enqueueIndexingJob,
  inferEntitySourceFromId,
  type EntitySource,
} from "@/lib/ops/indexing-jobs";

function entityTypeToSource(entityType: string): EntitySource | null {
  const t = entityType.trim().toLowerCase();
  if (t === "sra_organisation" || t === "sra") return "sra";
  if (t === "legal_aid_provider" || t === "legal_aid") return "legal_aid";
  if (
    t === "pro_bono_organisation" ||
    t === "law_centre" ||
    t === "advice_charity" ||
    t === "university_law_clinic" ||
    t === "probono"
  ) {
    return "probono";
  }
  if (t === "lawyer") return "lawyers";
  if (t === "curated_listing" || t === "curated") return "curated";
  return inferEntitySourceFromId(entityType);
}

/** Queue incremental Typesense re-index after admin approval. */
export async function enqueueProviderForIndexing(args: {
  entityId: string;
  entityType?: string;
  reason?: string;
}): Promise<void> {
  const source =
    (args.entityType && entityTypeToSource(args.entityType)) ||
    inferEntitySourceFromId(args.entityId);
  if (!source) return;
  await enqueueIndexingJob({
    entityId: args.entityId,
    entitySource: source,
    reason: args.reason ?? "enrichment_approved",
  });
}
