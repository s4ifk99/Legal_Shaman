/**
 * Export SRA organisations into HubSpot Contacts import format.
 *
 * Run:
 *   npx tsx scripts/export-sra-hubspot-contacts-csv.ts
 *   npx tsx scripts/export-sra-hubspot-contacts-csv.ts --limit=1000 --out=/path/to/file.csv
 */
import "./load-dotenv";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "../lib/db/prisma";

const DEFAULT_OUT = path.resolve(
  process.env.HOME || "",
  "Downloads",
  `HubSpot Contacts - SRA Firms.csv`,
);

/** Matches HubSpot Contacts Template.csv column headers. */
const HUBSPOT_CONTACT_HEADERS = [
  "First Name",
  "Last Name",
  "Email Address",
  "Phone Number",
  "City",
  "Lifecycle Stage",
  "Contact Owner",
  "Favorite Ice Cream Flavor",
] as const;

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function firmName(r: {
  displayName: string;
  organisationName: string;
  tradingName: string;
  firmName: string;
  businessName: string;
  sraId: string;
}): string {
  return (
    r.displayName?.trim() ||
    r.organisationName?.trim() ||
    r.tradingName?.trim() ||
    r.firmName?.trim() ||
    r.businessName?.trim() ||
    `SRA ${r.sraId}`
  );
}

/**
 * HubSpot Contacts need Last Name; keep the firm identity as one string there
 * and leave First Name blank so Company Names are not split.
 */
function companyAsContactName(fullName: string): { first: string; last: string } {
  const name = fullName.trim().slice(0, 200);
  if (!name) return { first: "", last: "Unknown firm" };
  return { first: "", last: name };
}

function parseArg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`${name}=`));
  return hit?.split("=").slice(1).join("=") || fallback;
}

async function main() {
  const limit = Math.max(1, Number(parseArg("--limit", "1000")) || 1000);
  const outPath = parseArg("--out", DEFAULT_OUT);
  const lifecycleStage = parseArg("--lifecycle", "Lead");

  const rows = await prisma.sraOrganisation.findMany({
    select: {
      sraId: true,
      businessName: true,
      displayName: true,
      organisationName: true,
      tradingName: true,
      firmName: true,
      website: true,
      phone: true,
      email: true,
      city: true,
      postcode: true,
      county: true,
    },
    orderBy: { sraId: "asc" },
    take: limit,
  });

  const lines = [HUBSPOT_CONTACT_HEADERS.join(",")];

  for (const r of rows) {
    const name = firmName(r);
    if (/^SRA organisation/i.test(name)) continue;

    const { first, last } = companyAsContactName(name);
    const email = (r.email || "").trim();
    const phone = (r.phone || "").trim();
    const city = (r.city || "").trim();

    lines.push(
      [
        csvEscape(first), // blank — do not split company names
        csvEscape(last), // full company name
        csvEscape(email),
        csvEscape(phone),
        csvEscape(city),
        csvEscape(lifecycleStage),
        "", // Contact Owner
        "", // custom sample column — leave blank
      ].join(","),
    );
  }

  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, lines.join("\n") + "\n", "utf8");

  const withEmail = rows.filter((r) => r.email?.trim()).length;
  const withPhone = rows.filter((r) => r.phone?.trim()).length;

  console.log(
    JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        outPath,
        limit,
        exportedRows: lines.length - 1,
        sourceRows: rows.length,
        withEmail,
        withPhone,
        lifecycleStage,
        headers: HUBSPOT_CONTACT_HEADERS,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
