const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidWaitlistEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

export async function appendWaitlistEmailToGoogleSheet(email: string): Promise<void> {
  const webhookUrl = process.env.WAITLIST_GOOGLE_APPS_SCRIPT_URL?.trim();
  if (!webhookUrl) {
    throw new Error("WAITLIST_GOOGLE_APPS_SCRIPT_URL is not configured");
  }

  const normalized = email.trim().toLowerCase();
  const body: Record<string, string> = { email: normalized };
  const secret = process.env.WAITLIST_GOOGLE_APPS_SCRIPT_SECRET?.trim();
  if (secret) body.secret = secret;

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let payload: { success?: boolean; error?: string } = {};
  try {
    payload = JSON.parse(text) as typeof payload;
  } catch {
    /* non-JSON response */
  }

  if (!response.ok || payload.error) {
    throw new Error(payload.error ?? `Google Sheet webhook failed (${response.status})`);
  }
}
