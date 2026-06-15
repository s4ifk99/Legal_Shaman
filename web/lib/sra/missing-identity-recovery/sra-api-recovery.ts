import type { SraLookupAttemptTrace } from "@/lib/sra/register-lookup";
import { lookupSraApiForIdentityRecovery } from "@/lib/sra/register-lookup";
import type { RecoveryContext, SraIdentityCandidateRecord } from "@/lib/sra/missing-identity-recovery/types";

function summariseAttempts(attempts: SraLookupAttemptTrace[]): string {
  return attempts
    .slice(0, 6)
    .map(
      (a) =>
        `${a.channel}:${a.outcome}${a.httpStatus ? `:http_${a.httpStatus}` : ""}${a.parseNote ? `:${a.parseNote}` : ""}`,
    )
    .join("; ");
}

/** Step 2: official SRA API by organisation number. */
export async function recoverFromSraApi(ctx: RecoveryContext): Promise<{
  candidates: SraIdentityCandidateRecord[];
  api404: boolean;
  attempts: SraLookupAttemptTrace[];
  queries: string[];
}> {
  const queries = [`SRA Data Share organisation/Get?OrganisationId=${ctx.sraId}`];
  const { result, api404, attempts } = await lookupSraApiForIdentityRecovery(ctx.sraId);

  const candidates: SraIdentityCandidateRecord[] = [];
  if (result?.displayName && !result.rejectReason) {
    const name = result.displayName.trim();
    candidates.push({
      sraId: ctx.sraId,
      candidateName: name,
      sourceType: "sra_api",
      sourceUrl: result.sourceUrl,
      evidenceText: `sra_api_lookup authorised solicitors organisation; ${summariseAttempts(attempts)}`,
      candidatePhone: result.phone,
      candidateAddress: result.address,
      candidateWebsite: result.website,
      matchedPostcode: ctx.postcode || undefined,
      matchedTown: ctx.city || undefined,
      confidence: result.confidence,
      status: "pending_review",
    });
  } else if (result?.rejectReason === "address_like_name") {
    candidates.push({
      sraId: ctx.sraId,
      candidateName: result.displayName ?? "",
      sourceType: "sra_api",
      sourceUrl: result.sourceUrl,
      evidenceText: `sra_api_rejected_address_like; ${summariseAttempts(attempts)}`,
      confidence: 0,
      status: "rejected",
      rejectReason: "address_like_name",
    });
  }

  return { candidates, api404, attempts, queries };
}
