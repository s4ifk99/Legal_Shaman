import "server-only";

import { prisma } from "@/lib/db/prisma";
import { isTriageFeedbackEmailEnabled } from "@/lib/email/config";
import { sendTriageSummaryEmail } from "@/lib/email/triage-summary";
import type { TriageResultSection } from "@/lib/legal-search/triage/types";

export type SendTriageFeedbackSummaryInput = {
  sessionId: string;
  email: string;
  reviewConsent: boolean;
  mergedQuery: string;
  sections: TriageResultSection[];
  recipientName?: string;
  userId?: string;
};

function countResults(sections: TriageResultSection[]): number {
  return sections.reduce((n, s) => n + s.results.length, 0);
}

export async function sendTriageFeedbackSummary(
  input: SendTriageFeedbackSummaryInput,
): Promise<
  | { ok: true; alreadySent?: boolean }
  | { ok: false; error: string; status?: number }
> {
  if (!isTriageFeedbackEmailEnabled()) {
    return { ok: false, error: "feedback_email_disabled", status: 503 };
  }

  if (!input.reviewConsent) {
    return { ok: false, error: "review_consent_required", status: 400 };
  }

  const email = input.email.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "invalid_email", status: 400 };
  }

  const resultCount = countResults(input.sections);
  if (resultCount < 1) {
    return { ok: false, error: "no_results", status: 400 };
  }

  const existing = await prisma.triageFeedbackEmail.findUnique({
    where: { sessionId: input.sessionId },
    select: { id: true },
  });
  if (existing) {
    return { ok: true, alreadySent: true };
  }

  const sendResult = await sendTriageSummaryEmail({
    to: email,
    recipientName: input.recipientName,
    sessionId: input.sessionId,
    mergedQuery: input.mergedQuery,
    resultCount,
    sectionTitles: input.sections.map((s) => s.title),
    reviewConsent: input.reviewConsent,
  });

  if (!sendResult.ok) {
    return { ok: false, error: sendResult.error ?? "email_send_failed", status: 502 };
  }

  await prisma.triageFeedbackEmail.create({
    data: {
      sessionId: input.sessionId,
      email,
      reviewConsent: input.reviewConsent,
      userId: input.userId ?? null,
      mergedQuery: input.mergedQuery.slice(0, 800),
      resultCount,
    },
  });

  return { ok: true };
}
