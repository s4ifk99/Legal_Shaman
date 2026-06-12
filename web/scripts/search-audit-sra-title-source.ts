/**
 * Audit which title source would be used for SRA index documents.
 * Run: npm run search:audit:sra-title-source -- --limit=25
 */
import "./load-dotenv";

import { prisma } from "../lib/db/prisma";
import { auditSraTitleSources } from "../lib/search-index/sync-sra-names-typesense";

function parseArg(name: string): string | undefined {
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.split("=")[1];
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && process.argv[idx + 1] && !process.argv[idx + 1]!.startsWith("--")) {
    return process.argv[idx + 1];
  }
  return undefined;
}

async function main() {
  const limitRaw = parseArg("limit");
  const limit = limitRaw ? Number(limitRaw) : 25;
  if (!Number.isFinite(limit) || limit <= 0) {
    console.error("--limit must be a positive number");
    process.exit(1);
  }

  const rows = await auditSraTitleSources(prisma, limit);

  console.log(JSON.stringify({ event: "sra_title_source_audit", limit, count: rows.length }));
  console.log("entityId\tsraOrganisation.displayName\tfirm.businessName\tchosenIndexTitle\treason");
  for (const row of rows) {
    console.log(
      [
        row.entityId,
        row.sraOrganisationDisplayName,
        row.firmBusinessName ?? "",
        row.chosenIndexTitle,
        row.reason,
      ].join("\t"),
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
