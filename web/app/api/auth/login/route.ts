import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { LoginSchema } from "@/lib/bookmarks/schemas";
import { setUserSessionCookie } from "@/lib/auth/user-session";
import { verifyPassword } from "@/lib/auth/password";
import { clientIpFromRequest, verifyTurnstileToken } from "@/lib/auth/turnstile";
import { authRateLimitKey, checkAuthRateLimit } from "@/lib/auth/rate-limit";

export async function POST(req: Request) {
  const rateKey = authRateLimitKey(req, "login");
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

  const parsed = LoginSchema.safeParse(body);
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
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true, passwordHash: true },
  });

  if (!user) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  if (!user.passwordHash) {
    return NextResponse.json(
      { error: "Account requires password setup. Please create a new account." },
      { status: 401 },
    );
  }

  const valid = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!valid) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  await setUserSessionCookie(user.id);
  return NextResponse.json({
    user: { id: user.id, name: user.name, email: user.email },
  });
}
