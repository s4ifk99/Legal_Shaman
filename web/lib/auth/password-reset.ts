import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { accountsPrisma } from "@/lib/db/accounts";
import { hashPassword } from "@/lib/auth/password";
import { sendEmail, isEmailConfigured } from "@/lib/email/send";
import { ensurePasswordResetSchema } from "@/lib/auth/password-reset-schema";

const TOKEN_BYTES = 32;
const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function resetUrl(token: string): string {
  const base =
    process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "") ||
    "http://localhost:3000";
  return `${base}/reset-password?token=${encodeURIComponent(token)}`;
}

/**
 * Always returns a generic success shape so callers cannot enumerate emails.
 */
export async function requestPasswordReset(
  emailRaw: string,
): Promise<{ ok: true; sent: boolean; logged?: boolean; error?: string }> {
  await ensurePasswordResetSchema();
  const email = emailRaw.trim().toLowerCase();
  if (!email) return { ok: true, sent: false };

  const user = await accountsPrisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true, passwordHash: true },
  });

  // No account or legacy account without password — still look like success.
  if (!user?.passwordHash) return { ok: true, sent: false };

  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  await accountsPrisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
  await accountsPrisma.passwordResetToken.create({
    data: { tokenHash, userId: user.id, expiresAt },
  });

  const link = resetUrl(token);
  if (!isEmailConfigured()) {
    console.log("[password-reset] RESEND not configured — reset URL:", link);
    return { ok: true, sent: false, logged: true };
  }

  const name = user.name?.trim() || "there";
  const result = await sendEmail({
    to: user.email,
    subject: "Reset your Legal Shaman password",
    text: [
      `Hi ${name},`,
      "",
      "We received a request to reset your Legal Shaman password.",
      "Open this link to choose a new password (expires in 1 hour):",
      "",
      link,
      "",
      "If you did not ask for this, you can ignore this email.",
    ].join("\n"),
    html: `<p>Hi ${name},</p><p>We received a request to reset your Legal Shaman password.</p><p><a href="${link}">Choose a new password</a></p><p>This link expires in 1 hour. If you did not ask for this, you can ignore this email.</p>`,
  });

  if (!result.ok) return { ok: true, sent: false, error: result.error };
  return { ok: true, sent: true };
}

export async function resetPasswordWithToken(input: {
  token: string;
  password: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensurePasswordResetSchema();
  const token = input.token?.trim();
  if (!token) return { ok: false, error: "missing_token" };

  const tokenHash = hashToken(token);
  const row = await accountsPrisma.passwordResetToken.findUnique({
    where: { tokenHash },
    select: { userId: true, expiresAt: true },
  });
  if (!row) return { ok: false, error: "invalid_token" };
  if (row.expiresAt.getTime() < Date.now()) {
    await accountsPrisma.passwordResetToken.delete({ where: { tokenHash } }).catch(() => {});
    return { ok: false, error: "expired_token" };
  }

  const passwordHash = await hashPassword(input.password);
  await accountsPrisma.$transaction([
    accountsPrisma.user.update({
      where: { id: row.userId },
      data: { passwordHash },
    }),
    accountsPrisma.passwordResetToken.deleteMany({ where: { userId: row.userId } }),
  ]);

  return { ok: true };
}
