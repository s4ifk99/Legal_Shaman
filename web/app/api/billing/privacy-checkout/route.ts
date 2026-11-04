import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { createPrivacyCheckout, privacyCheckoutConfigured } from "@/lib/billing/stripe";
import { accountsPrisma } from "@/lib/db/accounts";
import { B2C_PRIVACY_COVER_DAYS } from "@/lib/billing/plan";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "auth_required" }, { status: 401 });

  if (!privacyCheckoutConfigured()) {
    // Interest-only path until STRIPE_PRICE_PRIVACY_99P is set.
    await accountsPrisma.privacyUpgrade.create({
      data: {
        userId: user.id,
        status: "interest",
      },
    });
    return NextResponse.json({
      interestRecorded: true,
      checkoutReady: false,
      message:
        "Interest recorded. Checkout opens once the 99p Stripe price is configured (STRIPE_PRICE_PRIVACY_99P).",
    });
  }

  try {
    const origin = new URL(req.url).origin;
    const checkout = await createPrivacyCheckout({
      userId: user.id,
      email: user.email,
      origin,
    });
    await accountsPrisma.privacyUpgrade.create({
      data: {
        userId: user.id,
        stripeSessionId: checkout.id,
        status: "pending",
        coversUntil: new Date(Date.now() + B2C_PRIVACY_COVER_DAYS * 24 * 60 * 60 * 1000),
      },
    });
    return NextResponse.json({ url: checkout.url, checkoutReady: true });
  } catch (error) {
    console.error("[billing] privacy checkout failed:", error);
    return NextResponse.json({ error: "privacy_checkout_failed" }, { status: 502 });
  }
}
