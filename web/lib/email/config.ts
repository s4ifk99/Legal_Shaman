import "server-only";

const DEFAULT_FROM = "Legal Shaman <noreply@legalshaman.com>";

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

export function isTriageFeedbackEmailEnabled(): boolean {
  const flag = process.env.ENABLE_TRIAGE_FEEDBACK_EMAIL?.trim().toLowerCase();
  if (flag === "false" || flag === "0") return false;
  return isEmailConfigured();
}

export function resolveEmailFrom(): string {
  return process.env.EMAIL_FROM?.trim() || DEFAULT_FROM;
}

export function resolveTrustpilotAfsBcc(): string | undefined {
  const bcc = process.env.TRUSTPILOT_AFS_BCC?.trim();
  return bcc || undefined;
}

export function resolveSiteUrl(): string {
  const url =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    process.env.OPENROUTER_HTTP_REFERER?.trim() ||
    "https://www.legalshaman.com";
  return url.replace(/\/+$/, "");
}
