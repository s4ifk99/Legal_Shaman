import "server-only";

import Stripe from "stripe";

let cachedStripe: Stripe | null = null;
let cachedKey = "";

export function stripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY?.trim() || "";
  if (!key) return null;
  if (!cachedStripe || cachedKey !== key) {
    cachedStripe = new Stripe(key);
    cachedKey = key;
  }
  return cachedStripe;
}

export function paidPriceId(): string {
  // Prefer weekly unlimited; fall back to legacy 4-week price during migration.
  return (
    process.env.STRIPE_PRICE_PAID_WEEKLY?.trim() ||
    process.env.STRIPE_PRICE_PAID_4_WEEK?.trim() ||
    // Live catalogue defaults (Legal Shaman Stripe account).
    "price_1UD4FAJl7fZiwYvchpPomyJm" // £3.49 / week
  );
}

export function billingConfigured(): boolean {
  return Boolean(stripeClient() && paidPriceId());
}

export async function createPaidCheckout(input: {
  userId: string;
  email: string;
  origin: string;
}): Promise<Stripe.Checkout.Session> {
  const stripe = stripeClient();
  const price = paidPriceId();
  if (!stripe || !price) throw new Error("billing_not_configured");

  return stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price, quantity: 1 }],
    customer_email: input.email,
    client_reference_id: input.userId,
    metadata: {
      legalShamanUserId: input.userId,
      revenueCatAppUserId: input.userId,
    },
    subscription_data: {
      metadata: {
        legalShamanUserId: input.userId,
        revenueCatAppUserId: input.userId,
      },
    },
    success_url: `${input.origin}/ask-the-shaman?billing=success`,
    cancel_url: `${input.origin}/ask-the-shaman?billing=cancelled`,
    allow_promotion_codes: true,
  });
}
