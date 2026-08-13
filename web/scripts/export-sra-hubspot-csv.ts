/**
 * Export SRA organisations for HubSpot company import.
 * Minimum columns: Company Name, Website, Phone Number.
 *
 * Run: cd web && npx tsx scripts/export-sra-hubspot-csv.ts
 * Optional: --out=/path/to/file.csv --require-both (default) | --require-either
 */
import "./load-dotenv";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "../lib/db/prisma";

const DEFAULT_OUT = path.resolve(
  process.cwd(),
  "exports",
  `sra-firms-hubspot-${new Date().toISOString().slice(0, 10)}.csv`,
);

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function normalizeWebsite(raw: string): string {
  const website = raw.trim();
  if (!website) return "";
  if (website.startsWith("http://") || website.startsWith("https://")) return website;
  return `https://${website.replace(/^\/\//, "")}`;
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

async function main() {
  const outPath = process.argv.find((a) => a.startsWith("--out="))?.split("=")[1] || DEFAULT_OUT;
  const requireEither = process.argv.includes("--require-either");

  const where = requireEither
    ? { OR: [{ website: { not: "" } }, { phone: { not: "" } }] }
    : { AND: [{ website: { not: "" } }, { phone: { not: "" } }] };

  const rows = await prisma.sraOrganisation.findMany({
    where,
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
      sraProfileUrl: true,
    },
    orderBy: { sraId: "asc" },
  });

  const header = [
    "Company name",
    "Website URL",
    "Phone Number",
    "City/Town",
    "Postal Code",
    "State/Region",
    "Company email",
    "SRA ID",
    "SRA Profile URL",
  ];

  const lines = [header.join(",")];
  for (const r of rows) {
    const name = firmName(r);
    // Skip placeholder names that have no useful identity for CRM outreach
    if (/^SRA organisation/i.test(name) && !r.website?.trim() && !r.phone?.trim()) continue;

    lines.push(
      [
        csvEscape(name),
        csvEscape(normalizeWebsite(r.website || "")),
        csvEscape((r.phone || "").trim()),
        csvEscape((r.city || "").trim()),
        csvEscape((r.postcode || "").trim()),
        csvEscape((r.county || "").trim()),
        csvEscape((r.email || "").trim()),
        csvEscape(r.sraId),
        csvEscape((r.sraProfileUrl || "").trim()),
      ].join(","),
    );
  }

  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, lines.join("\n") + "\n", "utf8");

  console.log(
    JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        outPath,
        mode: requireEither ? "require-either" : "require-both",
        count: lines.length - 1,
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
