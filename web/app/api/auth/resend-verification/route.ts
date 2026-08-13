import { NextResponse } from "next/server";

import { authInfrastructureError, authUnexpectedError } from "@/lib/auth/auth-route-errors";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { sendVerificationEmail } from "@/lib/auth/email-verification";
import { authRateLimitKey, checkAuthRateLimit } from "@/lib/auth/rate-limit";

export async function POST(req: Request) {
  try {
    const rateKey = authRateLimitKey(req, "resend-verification");
    const rate = checkAuthRateLimit(rateKey);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Too many attempts. Try again later." },
        { status: 429, headers: { "retry-after": String(rate.retryAfterSec ?? 60) } },
      );
    }

    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "auth_required" }, { status: 401 });
    }
    if (user.emailVerified) {
      return NextResponse.json({ ok: true, alreadyVerified: true });
    }

    const result = await sendVerificationEmail({
      id: user.id,
      email: user.email,
      name: user.name,
    });

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }

    return NextResponse.json({ ok: true, sent: result.sent, skipped: result.skipped });
  } catch (err) {
    return authInfrastructureError(err) ?? authUnexpectedError(err);
  }
}
