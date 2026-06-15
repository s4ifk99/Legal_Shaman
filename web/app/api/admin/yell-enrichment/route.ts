import { requireAdminApiRequest } from "@/lib/admin/auth";
import { adminJsonResponse } from "@/lib/admin/api-response";
import { loadYellCoverageMetrics } from "@/lib/provider-enrichment/yell-metrics";
import { prisma } from "@/lib/db/prisma";
import { setEnrichmentStatus } from "@/lib/provider-enrichment/review-queue";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await requireAdminApiRequest(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "pending_review";
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "100"), 300);

  const [rows, metrics] = await Promise.all([
    prisma.providerEnrichment.findMany({
      where: {
        sourceType: "yell",
        status,
      },
      orderBy: [{ confidence: "desc" }, { updatedAt: "desc" }],
      take: limit,
    }),
    loadYellCoverageMetrics(),
  ]);

  const sraIds = new Set<string>();
  for (const r of rows) {
    const m = r.entityId.match(/^sra:(\d+)$/i) || r.provenanceNote?.match(/approved_firm:([^;]+)/);
    if (m?.[1]) sraIds.add(m[1]);
  }

  const orgs =
    sraIds.size > 0
      ? await prisma.sraOrganisation.findMany({
          where: { sraId: { in: [...sraIds].filter((id) => /^\d+$/.test(id)) } },
          select: { sraId: true, displayName: true, organisationName: true },
        })
      : [];

  const orgBySra = new Map(orgs.map((o) => [o.sraId, o]));

  return adminJsonResponse({
    metrics,
    enrichments: rows.map((r) => {
      const sraId = r.entityId.replace(/^sra:/i, "");
      const org = /^\d+$/.test(sraId) ? orgBySra.get(sraId) : undefined;
      const approvedName =
        org?.displayName ||
        org?.organisationName ||
        r.provenanceNote?.match(/approved_firm:([^;]+)/)?.[1] ||
        "";
      const matchScore = Number(r.provenanceNote?.match(/yell_match_score:([\d.]+)/)?.[1] ?? 0);
      return {
        id: r.id,
        entityId: r.entityId,
        fieldName: r.fieldName,
        extractedValue: r.extractedValue,
        confidence: r.confidence,
        sourceUrl: r.sourceUrl,
        status: r.status,
        provenanceNote: r.provenanceNote,
        approvedProviderName: approvedName,
        yellListingName:
          r.fieldName === "contactPageUrl"
            ? r.provenanceNote?.includes("yell")
              ? approvedName
              : ""
            : r.provenanceNote,
        matchScore,
      };
    }),
  });
}

export async function POST(req: Request) {
  const denied = await requireAdminApiRequest(req);
  if (denied) return denied;

  const payload = (await req.json()) as { id?: string; action?: "approve" | "reject" };
  if (!payload.id || (payload.action !== "approve" && payload.action !== "reject")) {
    return adminJsonResponse({ error: "id and action required" }, { status: 400 });
  }

  const status = payload.action === "approve" ? "approved" : "rejected";
  const ok = await setEnrichmentStatus(payload.id, status);
  if (!ok) return adminJsonResponse({ error: "not_found" }, { status: 404 });
  return adminJsonResponse({ ok: true, status: payload.action });
}
