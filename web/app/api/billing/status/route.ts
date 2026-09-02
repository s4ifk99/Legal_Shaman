import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/get-current-user";
import { ensureBillingSchema } from "@/lib/billing/schema";
import { accountsPrisma } from "@/lib/db/accounts";
import { monthlySearchUsage } from "@/lib/coherence/usage";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "auth_required" }, { status: 401 });

  await ensureBillingSchema();
  const [used, subscription] = await Promise.all([
    monthlySearchUsage(user.id),
    accountsPrisma.billingSubscription.findUnique({ where: { userId: user.id } }),
  ]);
  const paid = user.plan === "paid";
  return NextResponse.json({
    plan: paid ? "paid" : "free",
    monthlySearchUsed: used,
    monthlySearchLimit: paid ? null : 5,
    subscriptionStatus: subscription?.status || null,
    currentPeriodEnd: subscription?.currentPeriodEnd?.toISOString() || null,
    price: "£3.49 every 4 weeks",
  });
}
