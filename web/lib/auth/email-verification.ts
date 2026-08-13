import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { accountsPrisma } from "@/lib/db/accounts";
import { sendEmail, isEmailConfigured } from "@/lib/email/send";
import { skipEmailVerificationInDev } from "@/lib/auth/coherence-auth-config";

const TOKEN_BYTES = 32;
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function verificationUrl(token: string): string {
  const base =
    process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "") ||
    "http://localhost:3000";
  return `${base}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
}

export async function markEmailVerified(userId: string): Promise<void> {
  await accountsPrisma.user.update({
    where: { id: userId },
    data: { emailVerifiedAt: new Date() },
  });
  await accountsPrisma.emailVerificationToken.deleteMany({ where: { userId } });
}

/** Create token and send verification email. No-op when email skipped in dev. */
export async function sendVerificationEmail(user: {
  id: string;
  email: string;
  name: string;
}): Promise<{ sent: boolean; skipped?: boolean; error?: string }> {
  if (skipEmailVerificationInDev()) {
    await markEmailVerified(user.id);
    return { sent: false, skipped: true };
  }

  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  await accountsPrisma.emailVerificationToken.deleteMany({ where: { userId: user.id } });
  await accountsPrisma.emailVerificationToken.create({
    data: { tokenHash, userId: user.id, expiresAt },
  });

  if (!isEmailConfigured()) {
    console.log("[email-verify] RESEND not configured — verification URL:", verificationUrl(token));
    return { sent: false, skipped: true };
  }

  const link = verificationUrl(token);
  const result = await sendEmail({
    to: user.email,
    subject: "Verify your Legal Shaman account",
    text: [
      `Hi ${user.name},`,
      "",
      "Please verify your email to analyse legal matters with Legal Shaman.",
      "",
      link,
      "",
      "This link expires in 24 hours.",
    ].join("\n"),
    html: `<p>Hi ${user.name},</p><p>Please verify your email to analyse legal matters with Legal Shaman.</p><p><a href="${link}">Verify email</a></p><p>This link expires in 24 hours.</p>`,
  });

  if (!result.ok) return { sent: false, error: result.error };
  return { sent: true };
}

export async function verifyEmailToken(rawToken: string): Promise<
  | { ok: true; userId: string }
  | { ok: false; error: string }
> {
  const token = rawToken?.trim();
  if (!token) return { ok: false, error: "missing_token" };

  const tokenHash = hashToken(token);
  const row = await accountsPrisma.emailVerificationToken.findUnique({
    where: { tokenHash },
    select: { userId: true, expiresAt: true },
  });
  if (!row) return { ok: false, error: "invalid_token" };
  if (row.expiresAt.getTime() < Date.now()) {
    await accountsPrisma.emailVerificationToken.delete({ where: { tokenHash } }).catch(() => {});
    return { ok: false, error: "expired_token" };
  }

  await markEmailVerified(row.userId);
  return { ok: true, userId: row.userId };
}

export async function isUserEmailVerified(userId: string): Promise<boolean> {
  if (skipEmailVerificationInDev()) return true;
  const user = await accountsPrisma.user.findUnique({
    where: { id: userId },
    select: { emailVerifiedAt: true },
  });
  return Boolean(user?.emailVerifiedAt);
}
