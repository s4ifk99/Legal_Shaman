/**
 * Inspect SRA organisation name fields in Postgres and index resolution.
 * Run: cd web && npm run debug:sra-names
 */
import "./load-dotenv";

import { prisma } from "../lib/db/prisma";
import { pickSraIndexTitle } from "../lib/search/sra-name-fields";
import { sraOrganisationToDocument } from "../lib/search-index/build-legal-entity-doc";

async function main() {
  const rows = await prisma.sraOrganisation.findMany({ take: 20, orderBy: { sraId: "asc" } });
  console.log(`SRA organisations (first ${rows.length}):\n`);

  for (const org of rows) {
    const searchText = org.searchText || "";
    const selected = pickSraIndexTitle(org.sraId, searchText, {
      displayName: org.displayName,
      tradingName: org.tradingName,
      organisationName: org.organisationName,
      firmName: org.firmName,
      businessName: org.businessName,
    });
    const doc = await sraOrganisationToDocument(org, { skipGeo: true });

    console.log("---");
    console.log(`sraId: ${org.sraId}`);
    console.log(`  businessName: ${org.businessName}`);
    console.log(`  displayName (db): ${org.displayName}`);
    console.log(`  organisationName: ${org.organisationName}`);
    console.log(`  tradingName: ${org.tradingName}`);
    console.log(`  firmName: ${org.firmName}`);
    console.log(`  searchText (first line): ${searchText.split("\n")[0] ?? ""}`);
    console.log(`  pickSraIndexTitle → ${selected}`);
    console.log(`  Typesense title → ${doc.title}`);
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
