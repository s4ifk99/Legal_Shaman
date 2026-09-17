import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/get-current-user";
import { ensureBillingSchema } from "@/lib/billing/schema";
import { B2C_FREE_SEARCH_LIMIT_DEFAULT, B2C_PAID_PRICE_LABEL } from "@/lib/billing/plan";
import { accountsPrisma } from "@/lib/db/accounts";
import { monthlySearchUsage } from "@/lib/coherence/usage";

export const dynamic = "force-dynamic";

function freeSearchLimit(): number {
  const v = Number(process.env.COHERENCE_FREE_MONTHLY_SEARCH_LIMIT);
  return Number.isFinite(v) && v > 0 ? v : B2C_FREE_SEARCH_LIMIT_DEFAULT;
}

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
    monthlySearchLimit: paid ? null : freeSearchLimit(),
    subscriptionStatus: subscription?.status || null,
    currentPeriodEnd: subscription?.currentPeriodEnd?.toISOString() || null,
    price: B2C_PAID_PRICE_LABEL,
  });
}
