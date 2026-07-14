import "server-only";

import {
  isEmailConfigured,
  resolveEmailFrom,
  resolveTrustpilotAfsBcc,
} from "@/lib/email/config";

export type SendEmailInput = {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  /** When true, BCC Trustpilot AFS address (review invitations). */
  trustpilotAfs?: boolean;
  replyTo?: string;
};

export type SendEmailResult =
  | { ok: true; id?: string; logged?: boolean }
  | { ok: false; error: string };

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const to = Array.isArray(input.to) ? input.to : [input.to];
  const from = resolveEmailFrom();

  const bcc: string[] = [];
  if (input.trustpilotAfs) {
    const afs = resolveTrustpilotAfsBcc();
    if (afs) bcc.push(afs);
  }

  if (!apiKey) {
    console.log("[email] RESEND_API_KEY not set — logging email instead");
    console.log("[email] From:", from);
    console.log("[email] To:", to.join(", "));
    if (bcc.length) console.log("[email] BCC:", bcc.join(", "));
    console.log("[email] Subject:", input.subject);
    console.log("[email] Body:\n", input.text);
    return { ok: true, logged: true };
  }

  const body: Record<string, unknown> = {
    from,
    to,
    subject: input.subject,
    text: input.text,
  };
  if (input.html) body.html = input.html;
  if (bcc.length) body.bcc = bcc;
  if (input.replyTo) body.reply_to = input.replyTo;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("[email] Resend error:", res.status, errText);
      return { ok: false, error: "email_send_failed" };
    }

    const data = (await res.json()) as { id?: string };
    return { ok: true, id: data.id };
  } catch (err) {
    console.error("[email] send failed:", err);
    return { ok: false, error: "email_send_failed" };
  }
}

export { isEmailConfigured };
