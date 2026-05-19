import { z } from "zod";

/** Retrieval/ranking intent from query text (directory/matcher; not triage chip state). */
export const FundingIntentSchema = z.enum([
  "legal_aid",
  "free_help",
  "private",
  "private_or_unspecified",
]);

export type FundingIntent = z.infer<typeof FundingIntentSchema>;

const LEGAL_AID_INTENT =
  /\b(legal aid|legalaid|laa|can't afford|cannot afford|no money|low income)\b/i;

const FREE_HELP_INTENT =
  /\b(free\s+(\w+\s+)?(lawyer|solicitor)|free help|pro bono|probono|law centre|law center|charity advice|volunteer lawyer|citizen'?s advice|citizens advice)\b/i;

const PRIVATE_INTENT =
  /\b(private solicitor|private lawyer|private\s+\w+\s+solicitor|hire a lawyer|pay for|fixed fee)\b/i;

const GENERIC_LAWYER =
  /\b(solicitor|solicitors|lawyer|lawyers|barrister|attorney|law firm|law firms)\b/i;

/**
 * Classify funding intent for ranking. Generic lawyer queries default to
 * private_or_unspecified (do not assume legal aid).
 */
export function detectFundingIntent(text: string): FundingIntent {
  const lower = text.toLowerCase().trim();
  if (!lower) return "private_or_unspecified";

  const wantsPrivate = PRIVATE_INTENT.test(lower);
  const wantsLegalAid = LEGAL_AID_INTENT.test(lower);
  const wantsFree = FREE_HELP_INTENT.test(lower);

  if (wantsPrivate && !wantsLegalAid && !wantsFree) return "private";
  if (wantsLegalAid && !wantsPrivate) return "legal_aid";
  if (wantsFree && !wantsPrivate) return "free_help";
  if (wantsLegalAid && wantsPrivate) return "private";

  if (GENERIC_LAWYER.test(lower)) return "private_or_unspecified";

  return "private_or_unspecified";
}

export function fundingIntentBoostsLegalAid(intent: FundingIntent): boolean {
  return intent === "legal_aid" || intent === "free_help";
}

export function fundingIntentPrefersPrivateSources(intent: FundingIntent): boolean {
  return intent === "private" || intent === "private_or_unspecified";
}
