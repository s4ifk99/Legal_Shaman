/**
 * Fetch all organisations from SRA Data Share GetAll, upsert into MySQL (when DATABASE_URL
 * is set), then upsert into Meilisearch.
 *
 * Loads `web/.env` then `web/.env.local` (override) so `npm run sra:sync` picks up Next.js-style secrets.
 * CI should keep using real environment variables (no file required).
 *
 * Env:
 *   SRA_APIM_SUBSCRIPTION_KEY (required)
 *   MEILISEARCH_HOST, MEILISEARCH_API_KEY (required)
 *   DATABASE_URL (optional) — mysql://… When set, each batch is written to DB before Meilisearch.
 *   SRA_ORGANISATIONS_URL (optional, default: official GetAll URL)
 *
 * Run from repo: cd web && npm run sra:sync
 */

import "./load-dotenv";
import { createPrismaClient } from "../lib/db/prisma";
import { MeiliSearch } from "meilisearch";
import { upsertSraDocumentsMysql, upsertFirmsFromSra } from "../lib/sra-mysql-sync";
import { ensureSraIndex } from "../lib/search/meilisearch-index";
import { SRA_MEILISEARCH_INDEX } from "../lib/search/meilisearch-config";
import {
  normaliseSraOrganisation,
  type SraMeiliDocument,
} from "../lib/search/sra-document";
import { linkFirmsToSra } from "../lib/sra/link-firms";
import { writeSraSyncState } from "../lib/sra/sync-state";

const DEFAULT_SRA_URL =
  "https://sra-prod-apim.azure-api.net/datashare/api/V1/organisation/GetAll";

/** Align DB + Meili chunks; each chunk is fully committed to MySQL before Meilisearch. */
const SYNC_CHUNK = 500;

function extractRows(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== "object") return [];
  const o = body as Record<string, unknown>;
  for (const k of [
    "value",
    "items",
    "data",
    "organisations",
    "Organisations",
    "results",
    "Results",
  ]) {
    const v = o[k];
    if (Array.isArray(v)) return v;
  }
  return [];
}

function extractNextUrl(body: unknown, currentUrl: string): string | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  const n = o["@odata.nextLink"] ?? o.nextLink ?? o.NextLink ?? o.next ?? o.Next;
  if (typeof n !== "string" || !n.trim()) return null;
  if (n.startsWith("http")) return n;
  try {
    return new URL(n, currentUrl).toString();
  } catch {
    return null;
  }
}

async function fetchAllOrganisations(
  key: string,
  startUrl: string,
): Promise<unknown[]> {
  const rows: unknown[] = [];
  const seen = new Set<string>();
  let url: string | null = startUrl;

  while (url) {
    if (seen.has(url)) {
      console.warn("Pagination repeated URL, stopping:", url);
      break;
    }
    seen.add(url);
    const res = await fetch(url, {
      headers: { "Ocp-Apim-Subscription-Key": key },
    });
    if (!res.ok) {
      throw new Error(`SRA HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
    }
    const body: unknown = await res.json();
    rows.push(...extractRows(body));
    url = extractNextUrl(body, url);
    if (url) console.log(`Fetched page, total rows so far: ${rows.length}, next…`);
  }

  return rows;
}

async function main() {
  const sraKey = process.env.SRA_APIM_SUBSCRIPTION_KEY?.trim();
  const host = process.env.MEILISEARCH_HOST?.trim();
  const meiliKey = process.env.MEILISEARCH_API_KEY?.trim() ?? "";
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (!sraKey) {
    console.error("Missing SRA_APIM_SUBSCRIPTION_KEY");
    process.exit(1);
  }
  const meiliEnabled = Boolean(host);
  if (!meiliEnabled && !databaseUrl) {
    console.error("Set MEILISEARCH_HOST and/or DATABASE_URL (Postgres-only sync for Typesense indexing).");
    process.exit(1);
  }

  const prisma = databaseUrl ? createPrismaClient() : null;
  if (prisma) {
    console.log("DATABASE_URL set — will upsert sra_organisations (and firms) per batch.");
  } else if (!meiliEnabled) {
    console.error("DATABASE_URL required when MEILISEARCH_HOST is unset.");
    process.exit(1);
  } else {
    console.log("DATABASE_URL not set — Meilisearch only.");
  }
  if (!meiliEnabled) {
    console.log("MEILISEARCH_HOST not set — skipping Meilisearch (use npm run search:index:sra for Typesense).");
  }

  const startUrl = process.env.SRA_ORGANISATIONS_URL?.trim() || DEFAULT_SRA_URL;
  console.log("Fetching SRA organisations from:", startUrl);
  const rawRows = await fetchAllOrganisations(sraKey, startUrl);
  console.log("Raw organisation rows:", rawRows.length);

  const docs: SraMeiliDocument[] = [];
  for (const row of rawRows) {
    if (!row || typeof row !== "object") continue;
    const doc = normaliseSraOrganisation(row as Record<string, unknown>);
    if (doc) docs.push(doc);
  }
  console.log("Normalised documents:", docs.length);

  const client = meiliEnabled ? new MeiliSearch({ host: host!, apiKey: meiliKey }) : null;
  if (client) {
    await ensureSraIndex(client);
  }
  const index = client?.index(SRA_MEILISEARCH_INDEX);

  const skipEmbeddings = process.argv.includes("--skip-embeddings");
  const embedKey = process.env.LLM_API_KEY?.trim();
  const willEmbed = Boolean(prisma) && Boolean(embedKey) && !skipEmbeddings;
  if (prisma && !embedKey) {
    console.log(
      "LLM_API_KEY not set — skipping per-chunk embeddings. Backfill later with `npm run sra:embed`.",
    );
  } else if (skipEmbeddings) {
    console.log("--skip-embeddings flag set — not embedding SRA orgs during sync.");
  }

  try {
    for (let i = 0; i < docs.length; i += SYNC_CHUNK) {
      const chunk = docs.slice(i, i + SYNC_CHUNK);
      if (prisma) {
        console.log(`Postgres upsert ${chunk.length} sra_organisations (offset ${i})…`);
        await upsertSraDocumentsMysql(prisma, chunk);
        console.log(`Postgres upsert ${chunk.length} firms (offset ${i})…`);
        await upsertFirmsFromSra(prisma, chunk);
      }
      if (index && client) {
        const task = await index.addDocuments(chunk);
        console.log(
          `Meilisearch addDocuments task ${task.taskUid} (${chunk.length} docs, offset ${i})`,
        );
        await client.tasks.waitForTask(task.taskUid, { timeout: 600_000 });
      }

      if (willEmbed) {
        const ids = chunk.map((d) => d.id);
        try {
          const { embedSraOrgsByIds } = await import("../lib/sra/embed");
          const n = await embedSraOrgsByIds(ids);
          console.log(`Embedded ${n}/${ids.length} SRA orgs (offset ${i}).`);
        } catch (err) {
          console.warn(
            `[sra:sync] embedding chunk at offset ${i} failed (continuing):`,
            err instanceof Error ? err.message : err,
          );
        }
      }
    }

    if (prisma) {
      console.log("Linking existing Firm rows to SRA records by normalised name…");
      const linkResult = await linkFirmsToSra();
      console.log(
        `Linked ${linkResult.linked} firms; ${linkResult.skipped} skipped, ${linkResult.ambiguous} ambiguous.`,
      );
    }
  } finally {
    await prisma?.$disconnect();
  }

  await writeSraSyncState({
    lastSuccessAt: new Date().toISOString(),
    organisationsUpserted: docs.length,
    errors: [],
  });

  if (meiliEnabled) {
    console.log("Done. Meilisearch index:", SRA_MEILISEARCH_INDEX);
  } else {
    console.log("Done. Postgres sra_organisations updated — run npm run search:index:sra for Typesense.");
  }
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
