import type { PrismaClient } from "@prisma/client";

import type { TransferredCounts } from "@/lib/sra/sra-logical-dedupe-types";
import { sraEntityId } from "@/lib/sra/sra-logical-dedupe-scoring";

type OrgSnapshot = {
  id: string;
  sraId: string;
  businessName: string;
  displayName: string;
  organisationName: string;
  searchText: string;
  phone: string;
  email: string;
  website: string;
  postcode: string;
  city: string;
};

async function reverseEntityIds(
  prisma: PrismaClient,
  table: keyof TransferredCounts,
  ids: string[] | undefined,
  update: (id: string, oldEntityId: string) => Promise<unknown>,
  oldEntityId: string,
): Promise<number> {
  if (!ids?.length) return 0;
  let n = 0;
  for (const id of ids) {
    await update(id, oldEntityId);
    n++;
  }
  return n;
}

export async function restoreSraLogicalDedupe(
  prisma: PrismaClient,
  auditId: string,
): Promise<{ restored: boolean; oldSraId: string; reversedRecords: number }> {
  const audit = await prisma.sraLogicalDedupeAudit.findUnique({ where: { id: auditId } });
  if (!audit) throw new Error(`Audit record not found: ${auditId}`);
  if (audit.restoredAt) throw new Error(`Audit ${auditId} already restored at ${audit.restoredAt.toISOString()}`);
  if (audit.dryRun) throw new Error(`Audit ${auditId} was a dry-run — nothing to restore`);

  const old = audit.oldSnapshot as OrgSnapshot;
  const counts = audit.transferredCounts as TransferredCounts;
  const oldEntityId = sraEntityId(audit.oldSraId);
  const newEntityId = sraEntityId(audit.newSraId);
  let reversed = 0;

  const existing = await prisma.sraOrganisation.findUnique({ where: { sraId: audit.oldSraId } });
  if (!existing) {
    await prisma.sraOrganisation.create({
      data: {
        id: old.id,
        sraId: old.sraId,
        businessName: old.businessName,
        displayName: old.displayName,
        organisationName: old.organisationName,
        searchText: old.searchText,
        phone: old.phone,
        email: old.email,
        website: old.website,
        postcode: old.postcode,
        city: old.city,
        county: "",
        country: "",
        sraProfileUrl: `https://www.sra.org.uk/consumers/solicitor-check/?searchType=Organisation&searchText=${encodeURIComponent(old.sraId)}`,
      },
    });
  }

  reversed += await reverseEntityIds(
    prisma,
    "provider_enrichments",
    counts.provider_enrichments,
    (id) => prisma.providerEnrichment.update({ where: { id }, data: { entityId: oldEntityId } }),
    oldEntityId,
  );

  const simple: {
    key: keyof TransferredCounts;
    update: (id: string) => Promise<unknown>;
  }[] = [
    { key: "provider_crawl_jobs", update: (id) => prisma.providerCrawlJob.update({ where: { id }, data: { entityId: oldEntityId } }) },
    { key: "provider_crawl_results", update: (id) => prisma.providerCrawlResult.update({ where: { id }, data: { entityId: oldEntityId } }) },
    { key: "provider_extracted_fields", update: (id) => prisma.providerExtractedField.update({ where: { id }, data: { entityId: oldEntityId } }) },
    { key: "provider_crawl_runs", update: (id) => prisma.providerCrawlRun.update({ where: { id }, data: { entityId: oldEntityId } }) },
    { key: "indexing_jobs", update: (id) => prisma.indexingJob.update({ where: { id }, data: { entityId: oldEntityId } }) },
    { key: "search_ranking_signals", update: (id) => prisma.searchRankingSignal.update({ where: { id }, data: { entityId: oldEntityId } }) },
    { key: "provider_websites", update: (id) => prisma.providerWebsite.update({ where: { id }, data: { entityId: oldEntityId } }) },
    { key: "provider_contacts", update: (id) => prisma.providerContact.update({ where: { id }, data: { entityId: oldEntityId } }) },
    { key: "provider_practice_areas", update: (id) => prisma.providerPracticeArea.update({ where: { id }, data: { entityId: oldEntityId } }) },
    { key: "provider_review_signals", update: (id) => prisma.providerReviewSignal.update({ where: { id }, data: { entityId: oldEntityId } }) },
  ];

  for (const row of simple) {
    const ids = counts[row.key];
    if (ids?.length) {
      for (const id of ids) await row.update(id);
      reversed += ids.length;
    }
  }

  if (counts.sra_identity_candidates?.length) {
    for (const id of counts.sra_identity_candidates) {
      await prisma.sraIdentityCandidate.update({
        where: { id },
        data: { organisationId: old.id, sraId: audit.oldSraId },
      });
    }
    reversed += counts.sra_identity_candidates.length;
  }

  if (counts.provider_enrichment_states?.length) {
    const newState = await prisma.providerEnrichmentState.findUnique({ where: { entityId: newEntityId } });
    if (newState && !(await prisma.providerEnrichmentState.findUnique({ where: { entityId: oldEntityId } }))) {
      await prisma.providerEnrichmentState.update({
        where: { entityId: newEntityId },
        data: { entityId: oldEntityId },
      });
      reversed++;
    }
  }

  await prisma.sraLogicalDedupeAudit.update({
    where: { id: auditId },
    data: { restoredAt: new Date() },
  });

  await prisma.indexingJob.create({
    data: {
      entityId: oldEntityId,
      entitySource: "sra",
      reason: `sra_logical_dedupe_restore:${auditId}`,
    },
  });

  return { restored: true, oldSraId: audit.oldSraId, reversedRecords: reversed };
}
