import { NextResponse } from "next/server";
import type Stripe from "stripe";

import { stripeClient } from "@/lib/billing/stripe";
import { syncStripeSubscription } from "@/lib/billing/subscriptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const stripe = stripeClient();
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim() || "";
  const signature = req.headers.get("stripe-signature") || "";
  if (!stripe || !secret) {
    return NextResponse.json({ error: "billing_not_configured" }, { status: 503 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(await req.text(), signature, secret);
  } catch (error) {
    return NextResponse.json(
      { error: "invalid_webhook", detail: error instanceof Error ? error.message : "signature_failed" },
      { status: 400 },
    );
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const subscriptionId =
        typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
      if (subscriptionId) {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        await syncStripeSubscription(subscription, session.client_reference_id || undefined);
      }
    } else if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      await syncStripeSubscription(event.data.object as Stripe.Subscription);
    }
  } catch (error) {
    console.error("[billing] Stripe webhook sync failed:", error);
    return NextResponse.json({ error: "webhook_sync_failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
