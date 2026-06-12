import { requireAdminApiRequest } from "@/lib/admin/auth";
import { adminJsonResponse } from "@/lib/admin/api-response";
import { buildCoverageLadderReport } from "@/lib/provider-enrichment-ladder/coverage-report";
import { loadCoverageReportInputs } from "@/lib/provider-enrichment-ladder/coverage-report-datasources";
import { setEnrichmentStatus } from "@/lib/provider-enrichment/review-queue";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await requireAdminApiRequest(req);
  if (denied) return denied;

  const inputs = await loadCoverageReportInputs({ take: 5000 });
  const report = await buildCoverageLadderReport(
    inputs.docs,
    inputs.enrichmentByEntity,
    inputs,
  );

  const pendingWebsites = await prisma.providerEnrichment
    .findMany({
      where: { status: "pending_review", fieldName: "website" },
      orderBy: { confidence: "desc" },
      take: 50,
    })
    .catch(() => []);

  const pendingContacts = await prisma.providerEnrichment
    .findMany({
      where: {
        status: "pending_review",
        fieldName: { in: ["phone", "email", "contactPageUrl"] },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    })
    .catch(() => []);

  const pendingPractice = await prisma.providerExtractedField
    .findMany({
      where: { status: "pending_review", fieldName: "practice_areas" },
      orderBy: { confidence: "desc" },
      take: 50,
    })
    .catch(() => []);

  return adminJsonResponse({
    report,
    reportValid: report.reportValid,
    degraded: report.degraded,
    dataSources: report.dataSources,
    health: report.health,
    pendingWebsites,
    pendingContacts,
    pendingPractice,
    topPriority: ("unavailable" in report.weak ? [] : report.weak.topPriority).map((w) => ({
      id: w.doc.id,
      title: w.doc.title,
      city: w.doc.city,
      postcode: w.doc.postcode,
      priorityScore: w.priorityScore,
      reasons: w.reasons,
      website: w.doc.website,
    })),
  });
}

export async function POST(req: Request) {
  const denied = await requireAdminApiRequest(req);
  if (denied) return denied;

  const body = (await req.json()) as {
    action?: "approve" | "reject";
    id?: string;
    source?: "enrichment" | "extracted";
  };

  if (!body.id || (body.action !== "approve" && body.action !== "reject")) {
    return adminJsonResponse({ error: "id and action=approve|reject required" }, { status: 400 });
  }

  if (body.source === "extracted") {
    await prisma.providerExtractedField.update({
      where: { id: body.id },
      data: { status: body.action === "approve" ? "approved" : "rejected" },
    });
    return adminJsonResponse({ success: true });
  }

  const ok = await setEnrichmentStatus(
    body.id,
    body.action === "approve" ? "approved" : "rejected",
  );
  return adminJsonResponse({ success: ok });
}
