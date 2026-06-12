import type { PrismaClient } from "@prisma/client";

import {
  DEDUPE_REASON_PRIORITY,
  type SraDedupePairCandidate,
  type SraDedupeReason,
  type SraLogicalDedupeReport,
} from "@/lib/sra/sra-logical-dedupe-types";
import {
  hasApprovedEnrichmentConflict,
  orgSnapshot,
  transferEntityReferences,
} from "@/lib/sra/sra-logical-dedupe-transfer";
import {
  isDeletableSraRow,
  isStrongKeeper,
  keeperScore,
  sraEntityId,
} from "@/lib/sra/sra-logical-dedupe-scoring";

const PNP = `UPPER(REPLACE(TRIM(p.postcode), ' ', ''))`;
const KNP = `UPPER(REPLACE(TRIM(k.postcode), ' ', ''))`;
const PPHONE = `NULLIF(REGEXP_REPLACE(p.phone, '[^0-9]', '', 'g'), '')`;
const KPHONE = `NULLIF(REGEXP_REPLACE(k.phone, '[^0-9]', '', 'g'), '')`;
const PDOMAIN = `LOWER(NULLIF(SPLIT_PART(REGEXP_REPLACE(p.website, '^https?://(www\\.)?', '', 'i'), '/', 1), ''))`;
const KDOMAIN = `LOWER(NULLIF(SPLIT_PART(REGEXP_REPLACE(k.website, '^https?://(www\\.)?', '', 'i'), '/', 1), ''))`;
const PEMAIL = `LOWER(NULLIF(TRIM(p.email), ''))`;
const KEMAIL = `LOWER(NULLIF(TRIM(k.email), ''))`;
const PADDR = `LOWER(NULLIF(TRIM(COALESCE(p.offices->0->>'address1', p.offices->0->>'Address1', '')), ''))`;
const KADDR = `LOWER(NULLIF(TRIM(COALESCE(k.offices->0->>'address1', k.offices->0->>'Address1', '')), ''))`;

const PLACEHOLDER_WHERE = `(
  display_name LIKE 'SRA organisation%'
  OR display_name ~ '^Organisation [0-9]+$'
)`;

const KEEPER_WHERE = `(
  display_name NOT LIKE 'SRA organisation%'
  AND display_name !~ '^Organisation [0-9]+$'
)`;

type RawPair = {
  old_sra_id: string;
  new_sra_id: string;
  reason: string;
  match_key: string;
  priority: number;
};

const PAIR_SQL = `
WITH candidates AS (
  SELECT p.sra_id AS old_sra_id, k.sra_id AS new_sra_id,
         'exact_email_match' AS reason, ${PEMAIL} AS match_key, 1 AS priority
  FROM sra_organisations p
  JOIN sra_organisations k ON ${PEMAIL} = ${KEMAIL} AND ${PEMAIL} IS NOT NULL
    AND p.sra_id <> k.sra_id
  WHERE ${PLACEHOLDER_WHERE.replace(/display_name/g, "p.display_name")}
    AND ${KEEPER_WHERE.replace(/display_name/g, "k.display_name")}

  UNION ALL

  SELECT p.sra_id, k.sra_id, 'exact_website_domain_match', ${PDOMAIN}, 2
  FROM sra_organisations p
  JOIN sra_organisations k ON ${PDOMAIN} = ${KDOMAIN} AND ${PDOMAIN} IS NOT NULL
    AND p.sra_id <> k.sra_id
  WHERE ${PLACEHOLDER_WHERE.replace(/display_name/g, "p.display_name")}
    AND ${KEEPER_WHERE.replace(/display_name/g, "k.display_name")}

  UNION ALL

  SELECT p.sra_id, k.sra_id, 'phone_postcode_match', (${PPHONE} || '|' || ${PNP}), 3
  FROM sra_organisations p
  JOIN sra_organisations k ON ${PPHONE} = ${KPHONE} AND ${PNP} = ${KNP}
   AND ${PPHONE} IS NOT NULL AND ${PNP} != '' AND p.sra_id <> k.sra_id
  WHERE ${PLACEHOLDER_WHERE.replace(/display_name/g, "p.display_name")}
    AND ${KEEPER_WHERE.replace(/display_name/g, "k.display_name")}

  UNION ALL

  SELECT p.sra_id, k.sra_id, 'exact_address_postcode_match', (${PADDR} || '|' || ${PNP}), 4
  FROM sra_organisations p
  JOIN sra_organisations k ON ${PADDR} = ${KADDR} AND ${PNP} = ${KNP}
   AND ${PADDR} IS NOT NULL AND ${PNP} != '' AND p.sra_id <> k.sra_id
  WHERE ${PLACEHOLDER_WHERE.replace(/display_name/g, "p.display_name")}
    AND ${KEEPER_WHERE.replace(/display_name/g, "k.display_name")}

  UNION ALL

  SELECT p.sra_id, k.sra_id, 'placeholder_address_matches_real_address',
         (${PNP} || '|' || COALESCE(NULLIF(LOWER(TRIM(p.city)), ''), ${PADDR}, '')), 5
  FROM sra_organisations p
  JOIN sra_organisations k ON ${PNP} = ${KNP} AND ${PNP} != ''
   AND (
     (LOWER(TRIM(p.city)) = LOWER(TRIM(k.city)) AND TRIM(p.city) != '')
     OR (${PADDR} = ${KADDR} AND ${PADDR} IS NOT NULL)
   )
   AND p.sra_id <> k.sra_id
  WHERE ${PLACEHOLDER_WHERE.replace(/display_name/g, "p.display_name")}
    AND ${KEEPER_WHERE.replace(/display_name/g, "k.display_name")}
),
ranked AS (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY old_sra_id ORDER BY priority, new_sra_id) AS rn
  FROM candidates
)
SELECT old_sra_id, new_sra_id, reason, match_key, priority
FROM ranked
WHERE rn = 1
ORDER BY old_sra_id
`;

async function findPairCandidates(
  prisma: PrismaClient,
  limit: number,
): Promise<SraDedupePairCandidate[]> {
  const rows = await prisma.$queryRawUnsafe<RawPair[]>(`${PAIR_SQL} LIMIT ${limit}`);
  return rows.map((r) => ({
    oldSraId: r.old_sra_id,
    newSraId: r.new_sra_id,
    reason: r.reason as SraDedupeReason,
    matchKey: r.match_key,
  }));
}

export async function runSraLogicalDedupe(
  prisma: PrismaClient,
  options: { limit: number; dryRun: boolean },
): Promise<SraLogicalDedupeReport> {
  const pairs = await findPairCandidates(prisma, options.limit);
  const report: SraLogicalDedupeReport = {
    examined: pairs.length,
    mergeable: 0,
    skippedConflict: 0,
    skippedWeakMatch: 0,
    skippedBetterName: 0,
    transferredEnrichments: 0,
    deletedRows: 0,
    dryRun: options.dryRun,
    examples: [],
  };

  for (const pair of pairs) {
    const [oldOrg, newOrg] = await Promise.all([
      prisma.sraOrganisation.findUnique({ where: { sraId: pair.oldSraId } }),
      prisma.sraOrganisation.findUnique({ where: { sraId: pair.newSraId } }),
    ]);

    if (!oldOrg || !newOrg) {
      report.skippedWeakMatch++;
      continue;
    }

    if (!isDeletableSraRow(oldOrg)) {
      report.skippedBetterName++;
      report.examples.push({
        oldSraId: pair.oldSraId,
        newSraId: pair.newSraId,
        reason: pair.reason,
        oldDisplayName: oldOrg.displayName,
        newDisplayName: newOrg.displayName,
        skipped: "old_row_not_deletable",
      });
      continue;
    }

    if (!isStrongKeeper(newOrg)) {
      report.skippedWeakMatch++;
      report.examples.push({
        oldSraId: pair.oldSraId,
        newSraId: pair.newSraId,
        reason: pair.reason,
        oldDisplayName: oldOrg.displayName,
        newDisplayName: newOrg.displayName,
        skipped: "keeper_not_strong_enough",
      });
      continue;
    }

    if (keeperScore(oldOrg) > keeperScore(newOrg)) {
      report.skippedBetterName++;
      report.examples.push({
        oldSraId: pair.oldSraId,
        newSraId: pair.newSraId,
        reason: pair.reason,
        oldDisplayName: oldOrg.displayName,
        newDisplayName: newOrg.displayName,
        skipped: "old_row_better_name_or_richer",
      });
      continue;
    }

    if (pair.reason === "placeholder_address_matches_real_address") {
      const offices = oldOrg.offices as Record<string, unknown>[] | null;
      const officeAddr = offices?.[0]
        ? String(offices[0].address1 ?? offices[0].Address1 ?? "").trim()
        : "";
      const hasStrongSignal =
        Boolean(oldOrg.email.trim()) ||
        Boolean(oldOrg.website.trim()) ||
        Boolean(oldOrg.phone.trim()) ||
        Boolean(officeAddr) ||
        Boolean(oldOrg.city.trim());
      if (!hasStrongSignal) {
        report.skippedWeakMatch++;
        report.examples.push({
          oldSraId: pair.oldSraId,
          newSraId: pair.newSraId,
          reason: pair.reason,
          oldDisplayName: oldOrg.displayName,
          newDisplayName: newOrg.displayName,
          skipped: "weak_postcode_only_match",
        });
        continue;
      }
    }

    const conflict = await hasApprovedEnrichmentConflict(
      prisma,
      sraEntityId(pair.oldSraId),
      sraEntityId(pair.newSraId),
    );
    if (conflict) {
      report.skippedConflict++;
      report.examples.push({
        oldSraId: pair.oldSraId,
        newSraId: pair.newSraId,
        reason: pair.reason,
        oldDisplayName: oldOrg.displayName,
        newDisplayName: newOrg.displayName,
        skipped: "approved_enrichment_conflict",
      });
      continue;
    }

    const transferred = await transferEntityReferences(
      prisma,
      pair.oldSraId,
      pair.newSraId,
      { dryRun: options.dryRun },
    );
    const enrichmentCount = transferred.provider_enrichments?.length ?? 0;
    report.transferredEnrichments += enrichmentCount;
    report.mergeable++;

    if (!options.dryRun) {
      await prisma.sraOrganisation.delete({ where: { id: oldOrg.id } });
      await prisma.firm.deleteMany({ where: { sraId: pair.oldSraId } });
      await prisma.indexingJob.create({
        data: {
          entityId: sraEntityId(pair.newSraId),
          entitySource: "sra",
          reason: `sra_logical_dedupe:${pair.reason}`,
        },
      });
    }

    await prisma.sraLogicalDedupeAudit.create({
      data: {
        oldSraId: pair.oldSraId,
        newSraId: pair.newSraId,
        reason: pair.reason,
        transferredCounts: transferred,
        oldSnapshot: orgSnapshot(oldOrg),
        newSnapshot: orgSnapshot(newOrg),
        dryRun: options.dryRun,
      },
    });

    if (!options.dryRun) report.deletedRows++;
    if (report.examples.length < 15) {
      report.examples.push({
        oldSraId: pair.oldSraId,
        newSraId: pair.newSraId,
        reason: pair.reason,
        oldDisplayName: oldOrg.displayName,
        newDisplayName: newOrg.displayName,
      });
    }
  }

  return report;
}

export { DEDUPE_REASON_PRIORITY };
