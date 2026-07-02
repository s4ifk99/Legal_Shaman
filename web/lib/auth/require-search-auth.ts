import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/get-current-user";

/** Return 401 JSON when search APIs require a signed-in user. */
export async function requireSearchAuthResponse(): Promise<NextResponse | null> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "auth_required" }, { status: 401 });
  }
  return null;
}
