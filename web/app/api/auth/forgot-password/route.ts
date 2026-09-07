import { NextResponse } from "next/server";

import { ForgotPasswordSchema } from "@/lib/bookmarks/schemas";
import { requestPasswordReset } from "@/lib/auth/password-reset";
import { authInfrastructureError, authUnexpectedError } from "@/lib/auth/auth-route-errors";
import { clientIpFromRequest, verifyTurnstileToken } from "@/lib/auth/turnstile";
import { authRateLimitKey, checkAuthRateLimit } from "@/lib/auth/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/auth/forgot-password — email a reset link (always generic success). */
export async function POST(req: Request) {
  try {
    const rateKey = authRateLimitKey(req, "forgot-password");
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

    const parsed = ForgotPasswordSchema.safeParse(body);
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

    await requestPasswordReset(parsed.data.email);
    return NextResponse.json({
      ok: true,
      message: "If an account exists for that email, we sent a reset link.",
    });
  } catch (err) {
    return authInfrastructureError(err) ?? authUnexpectedError(err);
  }
}
