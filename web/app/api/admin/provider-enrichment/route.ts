import { requireAdminApiRequest } from "@/lib/admin/auth";
import { adminJsonResponse } from "@/lib/admin/api-response";
import { loadApprovalAuditDashboard } from "@/lib/provider-enrichment/approval-audit-stats";
import {
  bulkAutoApproveGovUkStructured,
  bulkAutoApproveHighConfidenceNonConflicting,
  bulkAutoApproveOfficialContacts,
  bulkRejectDuplicateExtras,
  bulkSendAuditSampleToReview,
} from "@/lib/provider-enrichment/bulk-approval-actions";
import { listPendingEnrichments } from "@/lib/provider-enrichment/review-queue";

export const dynamic = "force-dynamic";

const BULK_ACTIONS = {
  bulk_govuk: bulkAutoApproveGovUkStructured,
  bulk_official_contacts: bulkAutoApproveOfficialContacts,
  bulk_high_confidence: bulkAutoApproveHighConfidenceNonConflicting,
  bulk_audit_sample: bulkSendAuditSampleToReview,
  bulk_reject_duplicates: bulkRejectDuplicateExtras,
} as const;

export async function GET(req: Request) {
  const denied = await requireAdminApiRequest(req);
  if (denied) return denied;

  const [pending, dashboard] = await Promise.all([
    listPendingEnrichments(200),
    loadApprovalAuditDashboard(),
  ]);
  return adminJsonResponse({ pending, dashboard });
}

export async function POST(req: Request) {
  const denied = await requireAdminApiRequest(req);
  if (denied) return denied;

  let body: { action?: string; limit?: number };
  try {
    body = (await req.json()) as { action?: string; limit?: number };
  } catch {
    return adminJsonResponse({ error: "invalid_json" }, { status: 400 });
  }

  const action = body.action as keyof typeof BULK_ACTIONS | undefined;
  if (!action || !(action in BULK_ACTIONS)) {
    return adminJsonResponse({ error: "unknown_action" }, { status: 400 });
  }

  const limit = typeof body.limit === "number" ? body.limit : 500;
  const result = await BULK_ACTIONS[action](limit);
  const dashboard = await loadApprovalAuditDashboard();
  return adminJsonResponse({ result, dashboard });
}
