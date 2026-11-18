/**
 * Public Legal Shaman mailbox aliases (inbox forwards).
 * Override via NEXT_PUBLIC_* when needed.
 */

export const QUESTIONS_EMAIL =
  (typeof process !== "undefined" &&
    process.env.NEXT_PUBLIC_QUESTIONS_EMAIL?.trim()) ||
  "questions@legalshaman.com";

/** BCC on client → solicitor cost-request emails so we learn typical fees. */
export const COSTS_EMAIL =
  (typeof process !== "undefined" &&
    process.env.NEXT_PUBLIC_COST_REQUEST_BCC?.trim()) ||
  "costs@legalshaman.com";

export function mailtoQuestions(subject?: string): string {
  const params = new URLSearchParams();
  if (subject?.trim()) params.set("subject", subject.trim());
  const q = params.toString();
  return q ? `mailto:${QUESTIONS_EMAIL}?${q}` : `mailto:${QUESTIONS_EMAIL}`;
}
