import { prisma } from "@/lib/db/prisma";

export type YellCoverageMetrics = {
  yellContactCandidates: number;
  yellAutoApprovedContacts: number;
  yellPendingContacts: number;
  yellRejectedIdentityCandidates: number;
  yellTownsScanned: number;
};

export async function loadYellCoverageMetrics(): Promise<YellCoverageMetrics | null> {
  try {
    const [
      yellContactCandidates,
      yellAutoApprovedContacts,
      yellPendingContacts,
      yellRejectedIdentityCandidates,
      townRows,
    ] = await Promise.all([
      prisma.providerEnrichment.count({ where: { sourceType: "yell" } }),
      prisma.providerEnrichment.count({
        where: { sourceType: "yell", status: "auto_approved" },
      }),
      prisma.providerEnrichment.count({
        where: { sourceType: "yell", status: { in: ["pending_review", "audit_review"] } },
      }),
      prisma.sraIdentityCandidate.count({
        where: { sourceType: "yell", status: "rejected" },
      }),
      prisma.providerEnrichment.findMany({
        where: {
          sourceType: "yell",
          provenanceNote: { contains: "yell_town:" },
        },
        select: { provenanceNote: true },
        take: 5000,
      }),
    ]);

    const towns = new Set<string>();
    for (const row of townRows) {
      const m = row.provenanceNote?.match(/yell_town:([^;]+)/);
      if (m?.[1]) towns.add(m[1].trim());
    }

    return {
      yellContactCandidates,
      yellAutoApprovedContacts,
      yellPendingContacts,
      yellRejectedIdentityCandidates,
      yellTownsScanned: towns.size,
    };
  } catch {
    return null;
  }
}
