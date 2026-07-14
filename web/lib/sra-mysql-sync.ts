import { Prisma, type PrismaClient } from "@prisma/client";

import type { SraMeiliDocument, SraV2Record } from "./search/sra-document";

function clamp(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max);
}

function v2UpsertData(doc: SraV2Record) {
  return {
    sraId: clamp(doc.sraId, 64),
    businessName: clamp(doc.displayName || doc.businessName, 512),
    organisationName: clamp(doc.organisationName ?? "", 512),
    displayName: clamp(doc.displayName || doc.businessName, 512),
    tradingName: clamp(doc.tradingName ?? "", 512),
    firmName: clamp(doc.firmName ?? "", 512),
    phone: clamp(doc.phone ?? "", 64),
    website: clamp(doc.website ?? "", 2048),
    email: clamp(doc.email ?? "", 512),
    authorisationStatus: clamp(doc.authorisationStatus ?? "", 64),
    searchText: doc.searchText,
    city: clamp(doc.city, 255),
    postcode: clamp(doc.postcode, 32),
    county: clamp(doc.county, 255),
    country: clamp(doc.country, 128),
    sraProfileUrl: clamp(doc.sraProfileUrl, 2048),
    source: clamp(doc.source, 16),
    tradingNames:
      doc.tradingNames.length > 0
        ? (doc.tradingNames as Prisma.InputJsonValue)
        : Prisma.JsonNull,
    previousNames:
      doc.previousNames.length > 0
        ? (doc.previousNames as Prisma.InputJsonValue)
        : Prisma.JsonNull,
    workArea:
      doc.workArea.length > 0 ? (doc.workArea as Prisma.InputJsonValue) : Prisma.JsonNull,
    offices:
      doc.offices.length > 0 ? (doc.offices as Prisma.InputJsonValue) : Prisma.JsonNull,
    rawPayload: doc.rawPayload as Prisma.InputJsonValue,
  };
}

/** Upsert one v2 SRA record — no multi-record transaction. */
export async function upsertSraV2Record(
  prisma: PrismaClient,
  doc: SraV2Record,
): Promise<void> {
  const data = v2UpsertData(doc);
  await prisma.sraOrganisation.upsert({
    where: { id: doc.id },
    create: { id: doc.id, ...data },
    update: data,
  });
}

/** Upsert one Firm row for a v2 SRA record — no transaction. */
export async function upsertFirmFromSraV2(
  prisma: PrismaClient,
  doc: SraV2Record,
): Promise<void> {
  const data = {
    name: clamp(doc.businessName, 512),
    sraProfileUrl: doc.sraProfileUrl || null,
    city: doc.city || null,
    postcode: doc.postcode || null,
    country: doc.country || null,
    website: doc.website || null,
    verified: true,
  };
  const firmId = `firm-sra-${doc.sraId}`;

  // Curated Firm rows may already use firm-sra-{id} without sraId set (link-firms / seed data).
  const existing = await prisma.firm.findFirst({
    where: { OR: [{ sraId: doc.sraId }, { id: firmId }] },
    select: { id: true },
  });

  if (existing) {
    await prisma.firm.update({
      where: { id: existing.id },
      data: { sraId: doc.sraId, ...data },
    });
    return;
  }

  await prisma.firm.create({
    data: {
      id: firmId,
      sraId: doc.sraId,
      ...data,
    },
  });
}

/**
 * @deprecated Use upsertSraV2Record in a loop. Kept for legacy batch callers.
 */
export async function upsertSraDocumentsMysql(
  prisma: PrismaClient,
  docs: SraMeiliDocument[],
): Promise<void> {
  for (const doc of docs) {
    await prisma.sraOrganisation.upsert({
      where: { id: doc.id },
      create: {
        id: doc.id,
        sraId: clamp(doc.sraId, 64),
        businessName: clamp(doc.displayName || doc.businessName, 512),
        organisationName: clamp(doc.organisationName ?? "", 512),
        displayName: clamp(doc.displayName || doc.businessName, 512),
        tradingName: clamp(doc.tradingName ?? "", 512),
        firmName: clamp(doc.firmName ?? "", 512),
        phone: clamp(doc.phone ?? "", 64),
        website: clamp(doc.website ?? "", 2048),
        email: clamp(doc.email ?? "", 512),
        authorisationStatus: clamp(doc.authorisationStatus ?? "", 64),
        searchText: doc.searchText,
        city: clamp(doc.city, 255),
        postcode: clamp(doc.postcode, 32),
        county: clamp(doc.county, 255),
        country: clamp(doc.country, 128),
        sraProfileUrl: clamp(doc.sraProfileUrl, 2048),
        source: clamp(doc.source, 16),
      },
      update: {
        sraId: clamp(doc.sraId, 64),
        businessName: clamp(doc.displayName || doc.businessName, 512),
        organisationName: clamp(doc.organisationName ?? "", 512),
        displayName: clamp(doc.displayName || doc.businessName, 512),
        tradingName: clamp(doc.tradingName ?? "", 512),
        firmName: clamp(doc.firmName ?? "", 512),
        phone: clamp(doc.phone ?? "", 64),
        website: clamp(doc.website ?? "", 2048),
        email: clamp(doc.email ?? "", 512),
        authorisationStatus: clamp(doc.authorisationStatus ?? "", 64),
        searchText: doc.searchText,
        city: clamp(doc.city, 255),
        postcode: clamp(doc.postcode, 32),
        county: clamp(doc.county, 255),
        country: clamp(doc.country, 128),
        sraProfileUrl: clamp(doc.sraProfileUrl, 2048),
        source: clamp(doc.source, 16),
      },
    });
  }
}

/**
 * @deprecated Use upsertFirmFromSraV2 in a loop.
 */
export async function upsertFirmsFromSra(
  prisma: PrismaClient,
  docs: SraMeiliDocument[],
): Promise<void> {
  for (const doc of docs) {
    await upsertFirmFromSraV2(prisma, {
      ...doc,
      tradingNames: [],
      previousNames: [],
      workArea: [],
      offices: [],
      rawPayload: {},
    });
  }
}
