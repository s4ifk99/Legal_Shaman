import type Typesense from "typesense";

type ImportLine = { success?: boolean; error?: string };

export type BulkImportProgress = {
  batchNumber: number;
  batchSize: number;
  successCount: number;
  failedCount: number;
  totalUpserted: number;
};

export type BulkImportResult = {
  documentsUpserted: number;
  errors: string[];
  batches: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function typesenseImportBatchSize(): number {
  const n = Number.parseInt(process.env.TYPESENSE_IMPORT_BATCH_SIZE ?? "100", 10);
  if (!Number.isFinite(n) || n < 1) return 100;
  return Math.min(n, 500);
}

export function typesenseImportPauseMs(): number {
  const n = Number.parseInt(process.env.TYPESENSE_IMPORT_PAUSE_MS ?? "250", 10);
  if (!Number.isFinite(n) || n < 0) return 250;
  return n;
}

export function isTypesenseOomError(message: string): boolean {
  return /OUT_OF_MEMORY/i.test(message) || (/422/.test(message) && /MEMORY/i.test(message));
}

function lineErrors(lines: ImportLine[]): string[] {
  return lines.filter((l) => !l.success).map((l) => l.error ?? "import line failed");
}

export async function importTypesenseDocumentsInBatches(
  client: InstanceType<typeof Typesense.Client>,
  collection: string,
  records: Record<string, unknown>[],
): Promise<BulkImportResult> {
  const errors: string[] = [];
  let documentsUpserted = 0;
  let batchSize = typesenseImportBatchSize();
  const pauseMs = typesenseImportPauseMs();
  let i = 0;
  let batchNumber = 0;

  while (i < records.length) {
    batchNumber++;
    const chunk = records.slice(i, i + batchSize);
    let imported = false;

    for (let attempt = 1; attempt <= 6; attempt++) {
      try {
        const importRes = (await client
          .collections(collection)
          .documents()
          .import(chunk, { action: "upsert" })) as ImportLine[];

        const failedLines = lineErrors(importRes);
        const oomLines = failedLines.filter((e) => isTypesenseOomError(e));

        if (oomLines.length > 0 && batchSize > 1) {
          batchSize = Math.max(1, Math.floor(batchSize / 2));
          console.warn(
            JSON.stringify({
              event: "typesense_import_batch_shrink",
              batchNumber,
              newBatchSize: batchSize,
              reason: oomLines[0],
            }),
          );
          await sleep(pauseMs * attempt);
          continue;
        }

        let ok = 0;
        for (const line of importRes) {
          if (line.success) ok++;
          else errors.push(line.error ?? "import line failed");
        }

        const progress: BulkImportProgress = {
          batchNumber,
          batchSize: chunk.length,
          successCount: ok,
          failedCount: chunk.length - ok,
          totalUpserted: documentsUpserted + ok,
        };
        console.info(JSON.stringify({ event: "typesense_import_batch", ...progress }));

        documentsUpserted += ok;
        i += chunk.length;
        imported = true;
        if (pauseMs > 0 && i < records.length) await sleep(pauseMs);
        break;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (isTypesenseOomError(msg) && batchSize > 1) {
          batchSize = Math.max(1, Math.floor(batchSize / 2));
          console.warn(
            JSON.stringify({
              event: "typesense_import_oom_retry",
              batchNumber,
              newBatchSize: batchSize,
              attempt,
              reason: msg,
            }),
          );
          await sleep(pauseMs * attempt);
          continue;
        }
        errors.push(msg);
        break;
      }
    }

    if (!imported) {
      errors.push(`batch ${batchNumber} failed at offset ${i}/${records.length}`);
      break;
    }
  }

  if (documentsUpserted === 0 && records.length > 0 && errors.some((e) => isTypesenseOomError(e))) {
    errors.push(
      "Typesense cluster returned OUT_OF_MEMORY for all import attempts. " +
        "Increase Typesense RAM, reduce collection size, or retry when the cluster is healthy. " +
        "Postgres display names are still used at search time via searchText resolution.",
    );
  }

  return { documentsUpserted, errors, batches: batchNumber };
}
