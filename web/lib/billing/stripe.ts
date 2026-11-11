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

/** One-time 99p privacy upgrade price (Exp 6). Empty = interest-only UI (no charge). */
export function privacyPriceId(): string {
  return process.env.STRIPE_PRICE_PRIVACY_99P?.trim() || "";
}

export function billingConfigured(): boolean {
  return Boolean(stripeClient() && paidPriceId());
}

export function privacyCheckoutConfigured(): boolean {
  return Boolean(stripeClient() && privacyPriceId());
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
    // Stripe emails paid invoices when Customer emails / Billing notifications are on.
    // Checkout still needs a customer email for receipts to have a destination.
    success_url: `${input.origin}/ask-the-shaman?billing=success`,
    cancel_url: `${input.origin}/ask-the-shaman?billing=cancelled`,
    allow_promotion_codes: true,
  });
}

export async function createPrivacyCheckout(input: {
  userId: string;
  email: string;
  origin: string;
}): Promise<Stripe.Checkout.Session> {
  const stripe = stripeClient();
  const price = privacyPriceId();
  if (!stripe || !price) throw new Error("privacy_billing_not_configured");

  return stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [{ price, quantity: 1 }],
    customer_email: input.email,
    client_reference_id: input.userId,
    metadata: {
      legalShamanUserId: input.userId,
      product: "privacy_upgrade_99p",
    },
    success_url: `${input.origin}/ask-the-shaman?privacy=success`,
    cancel_url: `${input.origin}/ask-the-shaman?privacy=cancelled`,
  });
}
