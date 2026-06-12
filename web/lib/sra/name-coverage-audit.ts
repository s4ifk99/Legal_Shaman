import type { PrismaClient } from "@prisma/client";
import { extractFirmNameFromSraSearchText } from "@/lib/search/sra-display";
import { organisationHasRecoveredName } from "@/lib/sra/missing-identity-recovery/candidate-promotion";
import {
  classifySraStoredName,
  isPlaceholderSraDisplayName,
} from "@/lib/sra/sra-name-quality";

export type SraNameCoverageReport = {
  event: "sra_name_coverage";
  total: number;
  realFirmNames: number;
  placeholderNames: number;
  addressLikeNames: number;
  idOnlySearchText: number;
  emptyNames: number;
  recoverableByLookup: number;
  stillUnresolved: number;
  withRecoveryProvenance: number;
  approvedIdentityCandidates: number;
  pendingIdentityCandidates: number;
  samples: {
    placeholder: string[];
    addressLike: string[];
    unresolved: string[];
  };
};

export async function buildSraNameCoverageReport(
  prisma: PrismaClient,
): Promise<SraNameCoverageReport> {
  const rows = await prisma.sraOrganisation.findMany({
    select: {
      sraId: true,
      displayName: true,
      businessName: true,
      searchText: true,
    },
  });

  let provenanceBySraId = new Map<string, { source: string | null; confidence: number | null }>();
  let approvedCandidateSraIds = new Set<string>();
  let approvedIdentityCandidates = 0;
  let pendingIdentityCandidates = 0;

  try {
    const withProv = await prisma.sraOrganisation.findMany({
      select: {
        sraId: true,
        nameRecoverySource: true,
        nameRecoveryConfidence: true,
      },
    });
    provenanceBySraId = new Map(
      withProv.map((r) => [
        r.sraId,
        { source: r.nameRecoverySource, confidence: r.nameRecoveryConfidence },
      ]),
    );
  } catch {
    /* migration not applied yet */
  }

  try {
    const [approvedRows, pendingCount] = await Promise.all([
      prisma.sraIdentityCandidate.findMany({
        where: { status: "auto_approved", candidateName: { not: "" } },
        select: { sraId: true },
      }),
      prisma.sraIdentityCandidate.count({
        where: { status: "pending_review", candidateName: { not: "" } },
      }),
    ]);
    approvedIdentityCandidates = approvedRows.length;
    pendingIdentityCandidates = pendingCount;
    approvedCandidateSraIds = new Set(approvedRows.map((r) => r.sraId));
  } catch {
    /* candidates table missing */
  }

  const report: SraNameCoverageReport = {
    event: "sra_name_coverage",
    total: rows.length,
    realFirmNames: 0,
    placeholderNames: 0,
    addressLikeNames: 0,
    idOnlySearchText: 0,
    emptyNames: 0,
    recoverableByLookup: 0,
    stillUnresolved: 0,
    withRecoveryProvenance: 0,
    approvedIdentityCandidates,
    pendingIdentityCandidates,
    samples: { placeholder: [], addressLike: [], unresolved: [] },
  };

  for (const row of rows) {
    const cls = classifySraStoredName(row.displayName, row.sraId);
    const prov = provenanceBySraId.get(row.sraId);
    const hasApprovedCandidate = approvedCandidateSraIds.has(row.sraId);

    if (
      organisationHasRecoveredName({
        displayName: row.displayName,
        sraId: row.sraId,
        nameRecoverySource: prov?.source,
        nameRecoveryConfidence: prov?.confidence,
        hasApprovedCandidate,
      })
    ) {
      report.withRecoveryProvenance++;
    }

    const displayIsPlaceholder = isPlaceholderSraDisplayName(row.displayName, row.sraId);

    switch (cls) {
      case "real_firm_name":
        report.realFirmNames++;
        break;
      case "placeholder":
        if (displayIsPlaceholder) {
          report.placeholderNames++;
          if (report.samples.placeholder.length < 5) {
            report.samples.placeholder.push(`${row.sraId}: ${row.displayName}`);
          }
        }
        report.recoverableByLookup++;
        break;
      case "address_like_name":
        report.addressLikeNames++;
        if (report.samples.addressLike.length < 5) {
          report.samples.addressLike.push(`${row.sraId}: ${row.displayName}`);
        }
        break;
      case "id_only":
        report.idOnlySearchText++;
        break;
      case "empty":
        report.emptyNames++;
        break;
    }

    const textFirm = extractFirmNameFromSraSearchText(row.searchText, row.sraId);
    const textIsIdOnly = !textFirm || textFirm === row.sraId || /^\d+$/.test(textFirm);
    if (textIsIdOnly && cls !== "real_firm_name") {
      if (cls !== "id_only") report.idOnlySearchText++;
    }

    if (displayIsPlaceholder || cls === "placeholder" || cls === "empty") {
      const recovered = organisationHasRecoveredName({
        displayName: row.displayName,
        sraId: row.sraId,
        nameRecoverySource: prov?.source,
        nameRecoveryConfidence: prov?.confidence,
        hasApprovedCandidate,
      });
      if (!recovered) {
        report.stillUnresolved++;
        if (report.samples.unresolved.length < 8) {
          report.samples.unresolved.push(`${row.sraId}: ${row.displayName || "(empty)"}`);
        }
      }
    }
  }

  return report;
}
