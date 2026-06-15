import type Typesense from "typesense";

import { LEGAL_ENTITIES_COLLECTION } from "@/lib/search-index/config";
import {
  estimatePatchBytes,
  type SraTitleAuditRow,
} from "@/lib/search-index/sra-title-source";
import { isTypesenseOomError } from "@/lib/search-index/typesense-bulk-import";

export type SraNamePatchProgress = {
  patched: number;
  failed: number;
  method: "import_update" | "document_update";
  avgPatchBytes: number;
  maxPatchBytes: number;
};

export type SraNamePatchResult = {
  documentsPatched: number;
  errors: string[];
  method: "import_update" | "document_update";
  progress: SraNamePatchProgress;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function patchViaImportUpdate(
  client: InstanceType<typeof Typesense.Client>,
  records: Record<string, unknown>[],
  debug: boolean,
): Promise<SraNamePatchResult> {
  const errors: string[] = [];
  let patched = 0;
  let maxPatchBytes = 0;
  let totalBytes = 0;
  const batchSize = 25;

  for (let i = 0; i < records.length; i += batchSize) {
    const chunk = records.slice(i, i + batchSize);
    for (const rec of chunk) {
      const bytes = estimatePatchBytes(rec);
      totalBytes += bytes;
      maxPatchBytes = Math.max(maxPatchBytes, bytes);
    }

    try {
      const importRes = (await client
        .collections(LEGAL_ENTITIES_COLLECTION)
        .documents()
        .import(chunk, { action: "update" })) as { success?: boolean; error?: string }[];

      for (const line of importRes) {
        if (line.success) patched++;
        else {
          const err = line.error ?? "import update failed";
          if (isTypesenseOomError(err)) throw new Error(err);
          errors.push(err);
        }
      }

      if (debug) {
        console.info(
          JSON.stringify({
            event: "sra_name_patch_import_batch",
            offset: i,
            batchSize: chunk.length,
            maxPatchBytes,
            avgPatchBytes: chunk.length ? Math.round(totalBytes / (patched || 1)) : 0,
          }),
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (isTypesenseOomError(msg)) throw e;
      errors.push(msg);
      break;
    }

    await sleep(50);
  }

  return {
    documentsPatched: patched,
    errors,
    method: "import_update",
    progress: {
      patched,
      failed: records.length - patched,
      method: "import_update",
      avgPatchBytes: records.length ? Math.round(totalBytes / records.length) : 0,
      maxPatchBytes,
    },
  };
}

async function patchViaDocumentUpdate(
  client: InstanceType<typeof Typesense.Client>,
  records: Record<string, unknown>[],
  debug: boolean,
): Promise<SraNamePatchResult> {
  const errors: string[] = [];
  let patched = 0;
  let maxPatchBytes = 0;
  let totalBytes = 0;

  for (const rec of records) {
    const id = String(rec.id);
    const bytes = estimatePatchBytes(rec);
    totalBytes += bytes;
    maxPatchBytes = Math.max(maxPatchBytes, bytes);

    try {
      await client.collections(LEGAL_ENTITIES_COLLECTION).documents(id).update(rec);
      patched++;
      if (debug && patched <= 3) {
        console.info(JSON.stringify({ event: "sra_name_patch_document_update", id, bytes, patch: rec }));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/404|not found/i.test(msg)) {
        errors.push(`missing document ${id}`);
        continue;
      }
      errors.push(`${id}: ${msg}`);
    }
  }

  return {
    documentsPatched: patched,
    errors,
    method: "document_update",
    progress: {
      patched,
      failed: records.length - patched,
      method: "document_update",
      avgPatchBytes: records.length ? Math.round(totalBytes / records.length) : 0,
      maxPatchBytes,
    },
  };
}

/** Patch SRA titles in Typesense using minimal partial updates (import update, then document update fallback). */
export async function patchSraNamesInTypesense(
  client: InstanceType<typeof Typesense.Client>,
  records: Record<string, unknown>[],
  options?: { debug?: boolean; forceDocumentUpdate?: boolean },
): Promise<SraNamePatchResult> {
  const debug = Boolean(options?.debug);

  if (!records.length) {
    return {
      documentsPatched: 0,
      errors: [],
      method: "document_update",
      progress: { patched: 0, failed: 0, method: "document_update", avgPatchBytes: 0, maxPatchBytes: 0 },
    };
  }

  if (options?.debug) {
    const sample = records[0]!;
    console.info(
      JSON.stringify({
        event: "sra_name_patch_audit",
        collection: LEGAL_ENTITIES_COLLECTION,
        action: options.forceDocumentUpdate ? "document_update" : "import_update_then_fallback",
        recordCount: records.length,
        samplePatch: sample,
        sampleBytes: estimatePatchBytes(sample),
        sampleKeys: Object.keys(sample),
      }),
    );
  }

  if (options?.forceDocumentUpdate) {
    return patchViaDocumentUpdate(client, records, debug);
  }

  try {
    return await patchViaImportUpdate(client, records, debug);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!isTypesenseOomError(msg)) throw e;
    console.warn(
      JSON.stringify({
        event: "sra_name_patch_fallback",
        reason: msg,
        fallback: "document_update",
      }),
    );
    return patchViaDocumentUpdate(client, records, debug);
  }
}

export function logTitleAuditSample(rows: SraTitleAuditRow[], limit = 5): void {
  console.info(JSON.stringify({ event: "sra_title_source_sample", rows: rows.slice(0, limit) }));
}
