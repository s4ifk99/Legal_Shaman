function resolveSiteUrl(): string {
  const url =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    process.env.OPENROUTER_HTTP_REFERER?.trim() ||
    "https://www.legalshaman.com";
  return url.replace(/\/+$/, "");
}

export type TriageSummaryEmailInput = {
  recipientName?: string;
  sessionId: string;
  mergedQuery: string;
  resultCount: number;
  sectionTitles: string[];
  reviewConsent: boolean;
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildTriageSummaryEmail(input: TriageSummaryEmailInput): {
  subject: string;
  text: string;
  html: string;
} {
  const siteUrl = resolveSiteUrl();
  const guidedUrl = `${siteUrl}/ask-the-shaman?guided=1`;
  const greeting = input.recipientName?.trim()
    ? `Hi ${input.recipientName.trim()},`
    : "Hi,";
  const sections =
    input.sectionTitles.length > 0
      ? input.sectionTitles.join(", ")
      : "legal providers";
  const subject = "Your Legal Shaman search results";

  const text = [
    greeting,
    "",
    "Thank you for using Legal Shaman. Here is a summary of your guided search.",
    "",
    `Reference: ${input.sessionId}`,
    `Issue: ${input.mergedQuery}`,
    `Providers found: ${input.resultCount} across ${sections}`,
    "",
    `View guided search again: ${guidedUrl}`,
    "",
    "This email is legal information and signposting only — not legal advice.",
    "Always check eligibility and availability with organisations directly.",
    "",
    input.reviewConsent
      ? "You agreed that Trustpilot may separately invite you to leave a review about Legal Shaman."
      : "",
    "",
    "Legal Shaman",
  ]
    .filter(Boolean)
    .join("\n");

  const html = `<!DOCTYPE html>
<html>
<body style="font-family: Georgia, serif; color: #1a1a1a; line-height: 1.6; max-width: 560px;">
  <p>${escapeHtml(greeting)}</p>
  <p>Thank you for using <strong>Legal Shaman</strong>. Here is a summary of your guided search.</p>
  <p style="background:#f5f5f0;padding:12px 16px;border-radius:8px;">
    <strong>Reference:</strong> ${escapeHtml(input.sessionId)}<br/>
    <strong>Issue:</strong> ${escapeHtml(input.mergedQuery)}<br/>
    <strong>Providers found:</strong> ${input.resultCount} (${escapeHtml(sections)})
  </p>
  <p><a href="${escapeHtml(guidedUrl)}" style="color:#b8860b;">Return to guided search</a></p>
  <p style="font-size:13px;color:#555;">
    This email is legal information and signposting only — not legal advice.
    Always check eligibility and availability with organisations directly.
  </p>
  ${
    input.reviewConsent
      ? `<p style="font-size:13px;color:#555;">You agreed that Trustpilot may separately invite you to leave a review about Legal Shaman.</p>`
      : ""
  }
  <p>Legal Shaman</p>
</body>
</html>`;

  return { subject, text, html };
}
