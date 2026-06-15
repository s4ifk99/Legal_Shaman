import { prisma } from "@/lib/db/prisma";

export type ApprovalAuditDashboard = {
  enrichment: {
    autoApproved: number;
    auditReview: number;
    manualReview: number;
    rejected: number;
    approved: number;
    bySource: Record<string, number>;
    autoBySource: Record<string, number>;
  };
  extracted: {
    autoApproved: number;
    auditReview: number;
    manualReview: number;
    rejected: number;
    approved: number;
  };
  calibration: {
    autoApprovedPendingLaterRejection: number;
    avgAutoConfidence: number;
    avgManualConfidence: number;
  };
};

export async function loadApprovalAuditDashboard(): Promise<ApprovalAuditDashboard> {
  const empty: ApprovalAuditDashboard = {
    enrichment: {
      autoApproved: 0,
      auditReview: 0,
      manualReview: 0,
      rejected: 0,
      approved: 0,
      bySource: {},
      autoBySource: {},
    },
    extracted: {
      autoApproved: 0,
      auditReview: 0,
      manualReview: 0,
      rejected: 0,
      approved: 0,
    },
    calibration: {
      autoApprovedPendingLaterRejection: 0,
      avgAutoConfidence: 0,
      avgManualConfidence: 0,
    },
  };

  try {
    const [enrichGroups, extractGroups, enrichAutoBySource, autoConf, manualConf, laterRejected] =
      await Promise.all([
        prisma.providerEnrichment.groupBy({
          by: ["status"],
          _count: { id: true },
        }),
        prisma.providerExtractedField.groupBy({
          by: ["status"],
          _count: { id: true },
        }),
        prisma.providerEnrichment.groupBy({
          by: ["sourceType"],
          where: { status: "auto_approved" },
          _count: { id: true },
        }),
        prisma.providerEnrichment.aggregate({
          where: { status: "auto_approved" },
          _avg: { confidence: true },
        }),
        prisma.providerEnrichment.aggregate({
          where: { status: { in: ["pending_review", "audit_review"] } },
          _avg: { confidence: true },
        }),
        prisma.providerEnrichment.count({
          where: {
            status: "rejected",
            policyDecision: "auto_approve",
          },
        }),
      ]);

    const countStatus = (groups: { status: string; _count: { id: number } }[]) => {
      const m: Record<string, number> = {};
      for (const g of groups) m[g.status] = g._count.id;
      return m;
    };

    const e = countStatus(enrichGroups);
    const x = countStatus(extractGroups);

    const autoBySource: Record<string, number> = {};
    for (const g of enrichAutoBySource) {
      autoBySource[g.sourceType] = g._count.id;
    }

    const bySourceRows = await prisma.providerEnrichment.groupBy({
      by: ["sourceType"],
      _count: { id: true },
    });
    const bySource: Record<string, number> = {};
    for (const g of bySourceRows) bySource[g.sourceType] = g._count.id;

    return {
      enrichment: {
        autoApproved: e.auto_approved ?? 0,
        auditReview: e.audit_review ?? 0,
        manualReview: e.pending_review ?? 0,
        rejected: e.rejected ?? 0,
        approved: e.approved ?? 0,
        bySource,
        autoBySource,
      },
      extracted: {
        autoApproved: x.auto_approved ?? 0,
        auditReview: x.audit_review ?? 0,
        manualReview: x.pending_review ?? 0,
        rejected: x.rejected ?? 0,
        approved: x.approved ?? 0,
      },
      calibration: {
        autoApprovedPendingLaterRejection: laterRejected,
        avgAutoConfidence: Math.round((autoConf._avg.confidence ?? 0) * 100) / 100,
        avgManualConfidence: Math.round((manualConf._avg.confidence ?? 0) * 100) / 100,
      },
    };
  } catch {
    return empty;
  }
}
