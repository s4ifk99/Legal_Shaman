import "server-only";

import type Stripe from "stripe";
import { accountsPrisma } from "@/lib/db/accounts";

const ACTIVE_STATUSES = new Set(["active", "trialing"]);

function subscriptionUserId(subscription: Stripe.Subscription, fallbackUserId?: string): string {
  return (
    String(subscription.metadata?.legalShamanUserId || "").trim() ||
    String(fallbackUserId || "").trim()
  );
}

export async function syncStripeSubscription(
  subscription: Stripe.Subscription,
  fallbackUserId?: string,
): Promise<boolean> {
  const userId = subscriptionUserId(subscription, fallbackUserId);
  if (!userId) return false;

  const active = ACTIVE_STATUSES.has(subscription.status);
  await accountsPrisma.billingSubscription.upsert({
    where: { userId },
    create: {
      userId,
      provider: "stripe",
      providerCustomerId: String(subscription.customer || "") || null,
      providerSubscriptionId: subscription.id,
      status: subscription.status,
      currentPeriodEnd: subscription.current_period_end
        ? new Date(subscription.current_period_end * 1000)
        : null,
    },
    update: {
      provider: "stripe",
      providerCustomerId: String(subscription.customer || "") || null,
      providerSubscriptionId: subscription.id,
      status: subscription.status,
      currentPeriodEnd: subscription.current_period_end
        ? new Date(subscription.current_period_end * 1000)
        : null,
    },
  });
  await accountsPrisma.user.update({
    where: { id: userId },
    data: { plan: active ? "paid" : "free" },
  });
  return true;
}

export async function syncRevenueCatEntitlement(input: {
  appUserId: string;
  active: boolean;
  subscriptionId?: string;
  currentPeriodEnd?: Date | null;
}): Promise<boolean> {
  const userId = input.appUserId.trim();
  if (!userId) return false;
  await accountsPrisma.billingSubscription.upsert({
    where: { userId },
    create: {
      userId,
      provider: "revenuecat",
      providerSubscriptionId: input.subscriptionId || null,
      status: input.active ? "active" : "expired",
      currentPeriodEnd: input.currentPeriodEnd || null,
    },
    update: {
      provider: "revenuecat",
      providerSubscriptionId: input.subscriptionId || null,
      status: input.active ? "active" : "expired",
      currentPeriodEnd: input.currentPeriodEnd || null,
    },
  });
  await accountsPrisma.user.update({
    where: { id: userId },
    data: { plan: input.active ? "paid" : "free" },
  });
  return true;
}
