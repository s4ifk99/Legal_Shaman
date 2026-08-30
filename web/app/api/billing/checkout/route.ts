import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/get-current-user";
import { billingConfigured, createPaidCheckout } from "@/lib/billing/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "auth_required" }, { status: 401 });
  if (!billingConfigured()) {
    return NextResponse.json({ error: "billing_not_configured" }, { status: 503 });
  }

  try {
    const origin = new URL(req.url).origin;
    const checkout = await createPaidCheckout({
      userId: user.id,
      email: user.email,
      origin,
    });
    return NextResponse.json({ url: checkout.url });
  } catch (error) {
    console.error("[billing] checkout failed:", error);
    return NextResponse.json({ error: "checkout_failed" }, { status: 502 });
  }
}
