import { extractFirmNameFromSraSearchText } from "@/lib/search/sra-display";
import { pickSraIndexTitle } from "@/lib/search/sra-name-fields";
import type { RecoveryContext, SraIdentityCandidateRecord } from "@/lib/sra/missing-identity-recovery/types";
import { scoreIdentityCandidate } from "@/lib/sra/missing-identity-recovery/confidence";

function parseSearchTextLines(searchText: string, sraId: string): string[] {
  return searchText
    .split(/\n/)
    .map((l) => l.trim())
    .filter((line) => {
      if (!line) return false;
      if (line === sraId) return false;
      if (/^\d{4,}$/.test(line)) return false;
      if (/^SRA\s+organisation\s+\d+$/i.test(line)) return false;
      if (/^Organisation\s+\d+$/i.test(line)) return false;
      return true;
    });
}

function extractAddressLine(lines: string[], ctx: RecoveryContext): string | undefined {
  for (const line of lines) {
    if (ctx.postcode && line.includes(ctx.postcode)) return line;
    if (/,/.test(line) && /\b(England|UK|Scotland|Wales)\b/i.test(line)) return line;
    if (/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i.test(line)) return line;
  }
  return lines.find((l) => l.includes(","));
}

/** Mine firm-name candidates from synced SRA columns and searchText. */
export function mineLocalSraCandidates(ctx: RecoveryContext): {
  candidates: SraIdentityCandidateRecord[];
  addressLine?: string;
} {
  const lines = parseSearchTextLines(ctx.searchText, ctx.sraId);
  const addressLine = extractAddressLine(lines, ctx) ?? ctx.postcode;

  const fromText = extractFirmNameFromSraSearchText(ctx.searchText, ctx.sraId);
  const fromFields = pickSraIndexTitle(ctx.sraId, ctx.searchText, {
    displayName: ctx.displayName,
    organisationName: ctx.displayName,
    tradingName: "",
    firmName: "",
    businessName: ctx.displayName,
  });

  const name = fromText || (fromFields.startsWith("SRA organisation") ? null : fromFields);
  if (!name) {
    return { candidates: [], addressLine };
  }

  const base = {
    sraId: ctx.sraId,
    candidateName: name,
    sourceType: "local_sra" as const,
    sourceUrl: `postgres:sra_organisations?sraId=${ctx.sraId}`,
    evidenceText: `searchText firm line; postcode=${ctx.postcode}; city=${ctx.city}`,
    candidatePhone: ctx.phone || undefined,
    candidateAddress: addressLine,
    matchedPostcode: ctx.postcode || undefined,
    matchedTown: ctx.city || undefined,
  };

  const confidence = scoreIdentityCandidate({
    candidate: base,
    sraId: ctx.sraId,
    postcode: ctx.postcode,
    town: ctx.city,
    pageText: ctx.searchText,
    sraIdInEvidence: true,
  });

  return {
    addressLine,
    candidates: [
      {
        ...base,
        confidence,
        status: confidence >= 0.9 ? "auto_approved" : "pending_review",
      },
    ],
  };
}
