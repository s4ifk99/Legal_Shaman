/**
 * Provider enrichment CLI.
 * Usage:
 *   npm run providers:enrich [-- contacts|capabilities|all] [--limit N]
 */
import "./load-dotenv";

import {
  buildCuratedDocuments,
  buildLegalAidDocuments,
  buildLawyerDocuments,
  buildProBonoDocuments,
  buildSraDocuments,
} from "@/lib/search-index/build-legal-entity-doc";
import type { LegalEntityDocument } from "@/lib/search-index/types";
import { enrichProviderDocument, type EnrichmentMode } from "@/lib/provider-enrichment/enrichment-engine";

process.env.PROVIDER_ENRICHMENT_SKIP_FETCH ??= "1";

async function collectAll(): Promise<LegalEntityDocument[]> {
  const docs = [
    ...(await buildCuratedDocuments()),
    ...(await buildLegalAidDocuments()),
    ...(await buildLawyerDocuments()),
    ...(await buildProBonoDocuments()),
    ...(await buildSraDocuments()),
  ];
  const byId = new Map<string, LegalEntityDocument>();
  for (const d of docs) byId.set(d.id, d);
  return [...byId.values()];
}

async function main() {
  const modeArg = process.argv[2] ?? "all";
  const mode: EnrichmentMode =
    modeArg === "contacts" || modeArg === "capabilities" ? modeArg : "all";
  const limit = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? "50");

  const docs = await collectAll();
  const missingContact = docs.filter((d) => !d.phone || !d.email);
  const targets =
    mode === "capabilities"
      ? docs.slice(0, limit)
      : missingContact.slice(0, limit);

  const totals = {
    scanned: 0,
    candidates: 0,
    autoApproved: 0,
    pendingReview: 0,
    rejected: 0,
    skipped: 0,
    errors: [] as string[],
  };

  for (const doc of targets) {
    totals.scanned++;
    const stats = await enrichProviderDocument(doc, mode);
    totals.candidates += stats.candidates;
    totals.autoApproved += stats.autoApproved;
    totals.pendingReview += stats.pendingReview;
    totals.rejected += stats.rejected;
    totals.skipped += stats.skipped;
    totals.errors.push(...stats.errors);
  }

  console.info(
    JSON.stringify({
      event: "providers_enrich",
      mode,
      targets: targets.length,
      ...totals,
    }),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
