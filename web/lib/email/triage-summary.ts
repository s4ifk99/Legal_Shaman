import "server-only";

import { sendEmail } from "@/lib/email/send";
import {
  buildTriageSummaryEmail,
  type TriageSummaryEmailInput,
} from "@/lib/email/triage-summary-template";

export type { TriageSummaryEmailInput };

export { buildTriageSummaryEmail };

export async function sendTriageSummaryEmail(
  input: TriageSummaryEmailInput & { to: string },
): Promise<{ ok: boolean; error?: string }> {
  const { subject, text, html } = buildTriageSummaryEmail(input);
  const result = await sendEmail({
    to: input.to,
    subject,
    text,
    html,
    trustpilotAfs: input.reviewConsent,
  });
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}
