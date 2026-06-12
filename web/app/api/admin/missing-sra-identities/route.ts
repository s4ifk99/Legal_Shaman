import { requireAdminApiRequest } from "@/lib/admin/auth";
import { adminJsonResponse } from "@/lib/admin/api-response";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await requireAdminApiRequest(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "pending_review";
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "200"), 500);

  const rows = await prisma.sraIdentityCandidate.findMany({
    where: {
      status,
      candidateName: { not: "" },
    },
    orderBy: [{ confidence: "desc" }, { updatedAt: "desc" }],
    take: limit,
    include: {
      organisation: {
        select: {
          id: true,
          displayName: true,
          postcode: true,
          city: true,
          searchText: true,
        },
      },
    },
  });

  return adminJsonResponse({
    candidates: rows.map((r) => ({
      id: r.id,
      sraId: r.sraId,
      candidateName: r.candidateName,
      sourceType: r.sourceType,
      sourceUrl: r.sourceUrl,
      evidenceText: r.evidenceText,
      candidatePhone: r.candidatePhone,
      candidateAddress: r.candidateAddress,
      candidateWebsite: r.candidateWebsite,
      matchedPostcode: r.matchedPostcode,
      matchedTown: r.matchedTown,
      confidence: r.confidence,
      status: r.status,
      rejectReason: r.rejectReason,
      organisation: r.organisation,
    })),
  });
}
