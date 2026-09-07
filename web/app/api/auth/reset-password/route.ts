import { NextResponse } from "next/server";

import { ResetPasswordSchema } from "@/lib/bookmarks/schemas";
import { resetPasswordWithToken } from "@/lib/auth/password-reset";
import { authInfrastructureError, authUnexpectedError } from "@/lib/auth/auth-route-errors";
import { clientIpFromRequest, verifyTurnstileToken } from "@/lib/auth/turnstile";
import { authRateLimitKey, checkAuthRateLimit } from "@/lib/auth/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/auth/reset-password — set a new password from a reset token. */
export async function POST(req: Request) {
  try {
    const rateKey = authRateLimitKey(req, "reset-password");
    const rate = checkAuthRateLimit(rateKey);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Too many attempts. Try again later." },
        { status: 429, headers: { "retry-after": String(rate.retryAfterSec ?? 60) } },
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const parsed = ResetPasswordSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const captcha = await verifyTurnstileToken(
      parsed.data.captchaToken ?? "",
      clientIpFromRequest(req),
    );
    if (!captcha.ok) {
      return NextResponse.json({ error: captcha.error ?? "CAPTCHA failed" }, { status: 400 });
    }

    const result = await resetPasswordWithToken({
      token: parsed.data.token,
      password: parsed.data.password,
    });
    if (!result.ok) {
      const message =
        result.error === "expired_token"
          ? "This reset link has expired. Request a new one."
          : "This reset link is invalid or already used.";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, message: "Password updated. You can sign in now." });
  } catch (err) {
    return authInfrastructureError(err) ?? authUnexpectedError(err);
  }
}
