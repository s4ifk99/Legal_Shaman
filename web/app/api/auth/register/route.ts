import { NextResponse } from "next/server";
import { accountsPrisma } from "@/lib/db/accounts";
import { RegisterSchema } from "@/lib/bookmarks/schemas";
import { setUserSessionCookie } from "@/lib/auth/user-session";
import { hashPassword } from "@/lib/auth/password";
import { authInfrastructureError, authUnexpectedError } from "@/lib/auth/auth-route-errors";
import { clientIpFromRequest, verifyTurnstileToken } from "@/lib/auth/turnstile";
import { authRateLimitKey, checkAuthRateLimit } from "@/lib/auth/rate-limit";

function defaultNameFromEmail(email: string): string {
  const local = email.split("@")[0]?.trim();
  if (!local) return "User";
  return local.replace(/[._-]+/g, " ").slice(0, 255) || "User";
}

export async function POST(req: Request) {
  try {
    const rateKey = authRateLimitKey(req, "register");
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

    const parsed = RegisterSchema.safeParse(body);
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

    const email = parsed.data.email.toLowerCase();
    const existing = await accountsPrisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json(
        { error: "An account with this email already exists. Sign in instead." },
        { status: 409 },
      );
    }

    const passwordHash = await hashPassword(parsed.data.password);
    const name = parsed.data.name?.trim() || defaultNameFromEmail(email);

    const user = await accountsPrisma.user.create({
      data: { name, email, passwordHash },
      select: { id: true, name: true, email: true },
    });

    await setUserSessionCookie(user.id);
    return NextResponse.json({ user });
  } catch (err) {
    return authInfrastructureError(err) ?? authUnexpectedError(err);
  }
}
