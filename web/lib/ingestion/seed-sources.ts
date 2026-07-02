import type { PrismaClient } from "@prisma/client";

import { TRUSTED_LEGAL_SOURCES } from "@/lib/legal-knowledge/authority";

export async function seedLegalSources(prisma: PrismaClient): Promise<number> {
  let upserted = 0;
  for (const row of TRUSTED_LEGAL_SOURCES) {
    await prisma.legalSource.upsert({
      where: { domain: row.domain },
      create: {
        domain: row.domain,
        name: row.name,
        authorityWeight: row.authorityWeight,
        jurisdiction: row.jurisdiction ?? "England and Wales",
      },
      update: {
        name: row.name,
        authorityWeight: row.authorityWeight,
        jurisdiction: row.jurisdiction ?? "England and Wales",
      },
    });
    upserted += 1;
  }
  return upserted;
}

export async function ensureWikiSource(prisma: PrismaClient): Promise<string> {
  const domain = "wiki.legalshaman";
  const row = await prisma.legalSource.upsert({
    where: { domain },
    create: {
      domain,
      name: "Legal Shaman Wiki",
      authorityWeight: 0.72,
      jurisdiction: "England and Wales",
    },
    update: {
      name: "Legal Shaman Wiki",
      authorityWeight: 0.72,
    },
  });
  return row.id;
}
