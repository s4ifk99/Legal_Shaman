/**
 * Export SRA organisations with websites for the legal_shaman raw post crawler.
 * Run: cd web && npm run sra:export-crawl-index
 */
import "./load-dotenv";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { prisma } from "../lib/db/prisma";

const DEFAULT_OUT = path.resolve(
  process.env.LEGAL_SHAMAN_ROOT?.trim() || path.join(process.env.HOME || "", "Projects", "legal_shaman"),
  "data",
  "sra-firms-crawl-index.json",
);

function parseLimit(argv: string[]): number | undefined {
  const flag = argv.find((a) => a.startsWith("--limit="));
  if (!flag) return undefined;
  const n = Number(flag.split("=")[1]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

function parseOffset(argv: string[]): number {
  const flag = argv.find((a) => a.startsWith("--offset="));
  if (!flag) return 0;
  const n = Number(flag.split("=")[1]);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

async function main() {
  const outPath = process.argv.find((a) => a.startsWith("--out="))?.split("=")[1] || DEFAULT_OUT;
  const limit = parseLimit(process.argv);
  const offset = parseOffset(process.argv);
  const requireWebsite = !process.argv.includes("--all");

  const rows = await prisma.sraOrganisation.findMany({
    where: requireWebsite ? { website: { not: "" } } : undefined,
    select: {
      sraId: true,
      businessName: true,
      displayName: true,
      organisationName: true,
      tradingName: true,
      firmName: true,
      website: true,
      city: true,
      county: true,
    },
    orderBy: { sraId: "asc" },
    skip: offset,
    take: limit,
  });

  const firms = rows
    .map((r) => {
      const name =
        r.displayName?.trim() ||
        r.organisationName?.trim() ||
        r.tradingName?.trim() ||
        r.firmName?.trim() ||
        r.businessName?.trim() ||
        `SRA ${r.sraId}`;
      const website = r.website?.trim() || "";
      return {
        sraId: r.sraId,
        name,
        website: website.startsWith("http") ? website : website ? `https://${website.replace(/^\/\//, "")}` : "",
        city: r.city?.trim() || "",
        county: r.county?.trim() || "",
      };
    })
    .filter((f) => f.website);

  mkdirSync(path.dirname(outPath), { recursive: true });
  const payload = {
    exportedAt: new Date().toISOString(),
    offset,
    limit: limit ?? null,
    count: firms.length,
    firms,
  };
  writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
  console.info(JSON.stringify({ event: "sra_crawl_index_exported", outPath, count: firms.length }));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
