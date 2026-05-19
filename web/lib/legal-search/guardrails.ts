import "server-only";

export {
  sanitizeAdviceText,
  validateExplanation,
  validateExplanationAgainstTokens,
} from "@/lib/guardrails/validator";

import { sanitizeAdviceText as _sanitize } from "@/lib/guardrails/validator";

/** Strip outcome / advice language from any unified search user string. */
export function guardUserFacingText(s: string): string {
  return _sanitize(s);
}
