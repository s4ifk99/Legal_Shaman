/**
 * Audit SRA Data Share API coverage vs our DB + Typesense index.
 *
 * Usage:
 *   npm run sra:audit                    # live GetAll sample (needs SRA_APIM_SUBSCRIPTION_KEY)
 *   npm run sra:audit -- --file-only     # local data/sra-organisation-sample.json only
 *   npm run sra:audit -- --limit=500
 */
import "./load-dotenv";

import { prisma } from "../lib/db/prisma";
import {
  auditRawOrganisations,
  fetchGetAllSample,
  loadSampleOrganisationsFromFile,
  SRA_FIELDS_WE_DO_NOT_MAP,
  compareIndexShapeFromDbRow,
} from "../lib/sra/sra-api-audit";

async function main() {
  const argv = process.argv;
  const fileOnly = argv.includes("--file-only");
  const limit = Number(argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? "200");

  const reports: ReturnType<typeof auditRawOrganisations>[] = [];

  if (!fileOnly) {
    const key = process.env.SRA_APIM_SUBSCRIPTION_KEY?.trim();
    if (key) {
      try {
        console.info(`Fetching up to ${limit} organisations from SRA GetAll…`);
        const { rows, pages } = await fetchGetAllSample(key, limit);
        console.info(`Fetched ${rows.length} rows (${pages} page(s)).`);
        reports.push(auditRawOrganisations(rows, "live_getall"));
      } catch (e) {
        console.error("Live API audit failed:", e instanceof Error ? e.message : e);
      }
    } else {
      console.warn("SRA_APIM_SUBSCRIPTION_KEY not set — skipping live GetAll audit.");
    }
  }

  const fileRows = await loadSampleOrganisationsFromFile();
  if (fileRows.length) {
    reports.push(auditRawOrganisations(fileRows, "file"));
  }

  let dbCoverage: Record<string, number> | null = null;
  try {
    const total = await prisma.sraOrganisation.count();
    const withPhone = await prisma.sraOrganisation.count({ where: { phone: { not: "" } } });
    const withCity = await prisma.sraOrganisation.count({ where: { city: { not: "" } } });
    const withPostcode = await prisma.sraOrganisation.count({ where: { postcode: { not: "" } } });
    const placeholder = await prisma.sraOrganisation.count({
      where: { displayName: { startsWith: "SRA organisation" } },
    });
    const withTrading = await prisma.sraOrganisation.count({ where: { tradingName: { not: "" } } });
    dbCoverage = {
      total,
      withPhone,
      withCity,
      withPostcode,
      withTrading,
      placeholder,
      placeholderPct: total ? Math.round((placeholder / total) * 1000) / 10 : 0,
    };

    const sampleOrg = await prisma.sraOrganisation.findFirst({
      where: { phone: { not: "" }, city: { not: "" } },
    });
    if (sampleOrg) {
      const shape = await compareIndexShapeFromDbRow(sampleOrg);
      console.info("\nSample indexed org — fields empty in Typesense:", shape.emptyInIndex.join(", ") || "(none)");
    }
  } catch (e) {
    console.warn("DB coverage skipped:", e instanceof Error ? e.message : e);
  }

  const primary = reports.find((r) => r.source === "live_getall") ?? reports[0];

  console.info("\n=== SRA API → index audit ===\n");
  if (dbCoverage) {
    console.info("Postgres sra_organisations coverage:", JSON.stringify(dbCoverage, null, 2));
  }

  if (primary) {
    console.info(`\nRaw payload audit (${primary.source}, n=${primary.organisationCount}):`);
    console.info(`  Parsed: ${primary.normalisation.parsed}, dropped: ${primary.normalisation.dropped}, placeholder names: ${primary.normalisation.placeholderNames}`);
    console.info(`\n  Top unmapped JSON paths (sample):`);
    for (const u of primary.unmappedKeys.slice(0, 15)) {
      console.info(`    - ${u.key}${u.sampleValues.length ? ` e.g. ${u.sampleValues.join(" | ")}` : ""}`);
    }
    if (primary.frequentKeys.length) {
      console.info(`\n  Frequent keys (≥1% of sample):`);
      for (const f of primary.frequentKeys.slice(0, 20)) {
        console.info(`    - ${f.key} (${f.pct}%)`);
      }
    }
  }

  console.info("\nKnown gaps (SRA publishes → we do not structurally index):");
  for (const g of SRA_FIELDS_WE_DO_NOT_MAP) {
    console.info(`  - ${g.field}: ${g.indexImpact}`);
  }

  console.info("\nIndex shape gaps (from code review):");
  for (const g of primary?.indexGaps ?? []) {
    console.info(`  - ${g.field}: ${g.notes}`);
  }

  console.info(
    "\nFull JSON report written to stdout (pipe to file if needed).\n",
  );
  console.info(
    JSON.stringify(
      {
        event: "sra_api_index_audit",
        dbCoverage,
        reports,
        recommendations: [
          "Store raw JSON blob on sra_organisations for forward-compatible re-mapping",
          "Map Website + Email from API into dedicated columns",
          "Map AreasOfLaw to canonical practiceAreaSlugs at sync time (not searchText only)",
          "Persist all offices or at least head office flag + branch cities",
          "Map AuthorisationStatus to filter closed firms from search",
          "Use organisation/Get for placeholder recovery before external search",
        ],
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
