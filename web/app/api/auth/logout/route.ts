import { NextResponse } from "next/server";
import { clearUserSessionCookie } from "@/lib/auth/user-session";

export async function POST() {
  await clearUserSessionCookie();
  return NextResponse.json({ ok: true });
}
