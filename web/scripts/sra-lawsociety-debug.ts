/**
 * Debug Law Society SRA lookup — saves screenshot + HTML, prints DOM summary.
 * Usage: npm run sra:lawsociety:debug -- --sra=921469
 */
import "./load-dotenv";

import { prisma } from "../lib/db/prisma";
import { lookupLawSocietyBySraId, closeLawSocietyBrowser } from "../lib/sra/law-society-sra-recovery";
import { buildLawSocietyResultsUrl } from "../lib/sra/law-society-playwright";

function parseSra(argv: string[]): string | null {
  const flag = argv.find((a) => a.startsWith("--sra="));
  if (flag) return flag.split("=")[1]?.trim() ?? null;
  const idx = argv.indexOf("--sra");
  if (idx >= 0 && argv[idx + 1]) return argv[idx + 1]!.trim();
  return null;
}

async function main() {
  const sraId = parseSra(process.argv);
  if (!sraId) {
    console.error("Usage: npm run sra:lawsociety:debug -- --sra=921469");
    process.exit(1);
  }

  const row = await prisma.sraOrganisation.findFirst({
    where: { sraId: sraId.replace(/^sra:/i, "") },
    select: { postcode: true, displayName: true, businessName: true, city: true },
  });

  console.info(`expectedUrl: ${buildLawSocietyResultsUrl({ nameOrSraId: sraId })}`);
  if (row) {
    console.info(
      JSON.stringify({
        localPostcode: row.postcode,
        localDisplayName: row.displayName,
        localCity: row.city,
      }),
    );
  }

  const diag = await lookupLawSocietyBySraId(sraId, {
    postcodeHint: row?.postcode || undefined,
    displayNameHint: row?.displayName || row?.businessName || undefined,
    debug: true,
  });

  console.info(JSON.stringify(diag, null, 2));

  if (diag.result) {
    console.info(`\nRECOVERED: ${diag.result.organisationName} (${diag.result.confidence})`);
  } else {
    console.info("\nNOT RECOVERED — inspect reports/law-society-lookup-*.png and .html");
  }

  await closeLawSocietyBrowser();
  await prisma.$disconnect();

  const ok = Boolean(diag.result?.organisationName?.includes("Bhayani") || diag.result);
  process.exitCode = sraId === "921469" && !diag.result?.organisationName?.includes("Bhayani") ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
