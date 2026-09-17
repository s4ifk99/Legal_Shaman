import { NextResponse } from "next/server";

import { syncRevenueCatEntitlement } from "@/lib/billing/subscriptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INACTIVE_EVENTS = new Set(["EXPIRATION", "REFUND"]);

export async function POST(req: Request) {
  const secret = process.env.REVENUECAT_WEBHOOK_SECRET?.trim() || "";
  const authorization = req.headers.get("authorization") || "";
  if (!secret || authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: {
    event?: {
      type?: string;
      app_user_id?: string;
      transaction_id?: string;
      expiration_at_ms?: number | null;
    };
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const event = body.event;
  const appUserId = String(event?.app_user_id || "").trim();
  const type = String(event?.type || "").toUpperCase();
  if (!appUserId || !type) {
    return NextResponse.json({ error: "invalid_event" }, { status: 400 });
  }

  try {
    await syncRevenueCatEntitlement({
      appUserId,
      active: !INACTIVE_EVENTS.has(type),
      subscriptionId: event?.transaction_id,
      currentPeriodEnd: event?.expiration_at_ms
        ? new Date(event.expiration_at_ms)
        : null,
    });
  } catch (error) {
    console.error("[billing] RevenueCat webhook sync failed:", error);
    return NextResponse.json({ error: "webhook_sync_failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
