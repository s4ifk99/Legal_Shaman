import { NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  computeAdminSessionToken,
  getAdminSecret,
  isAdminMisconfiguredProduction,
  isProductionNodeEnv,
} from "@/lib/admin/auth";

export const runtime = "nodejs";

export async function GET() {
  const secret = getAdminSecret();
  return NextResponse.json({
    configured: Boolean(secret),
    misconfiguredProduction: isAdminMisconfiguredProduction(),
    loginRequired: Boolean(secret),
  });
}

export async function POST(req: Request) {
  if (isAdminMisconfiguredProduction()) {
    return NextResponse.json(
      { error: "ADMIN_SECRET is not configured; admin login is disabled in production." },
      { status: 503 },
    );
  }

  const secret = getAdminSecret();
  if (!secret) {
    return NextResponse.json(
      {
        error:
          "ADMIN_SECRET is not set. In local development the admin area is open without login; set ADMIN_SECRET to require a password.",
      },
      { status: 400 },
    );
  }

  let body: { password?: string };
  try {
    body = (await req.json()) as { password?: string };
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const password = body.password?.trim();
  if (!password || password !== secret) {
    return NextResponse.json({ error: "invalid password" }, { status: 401 });
  }

  const token = await computeAdminSessionToken(secret);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProductionNodeEnv(),
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
