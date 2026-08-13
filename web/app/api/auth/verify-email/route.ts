import { NextResponse } from "next/server";

import { verifyEmailToken } from "@/lib/auth/email-verification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/auth/verify-email?token=... — marks account verified and redirects home. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") || "";
  const result = await verifyEmailToken(token);

  const base =
    process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "") ||
    "http://localhost:3000";

  if (!result.ok) {
    const dest = new URL("/ask-the-shaman", base);
    dest.searchParams.set("verify", result.error);
    return NextResponse.redirect(dest);
  }

  const dest = new URL("/ask-the-shaman", base);
  dest.searchParams.set("verified", "1");
  return NextResponse.redirect(dest);
}
