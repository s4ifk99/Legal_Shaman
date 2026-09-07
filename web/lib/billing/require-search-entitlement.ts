import "server-only";

import { NextResponse } from "next/server";
import { createHash } from "node:crypto";

import { getCurrentUser } from "@/lib/auth/get-current-user";
import { isUserEmailVerified } from "@/lib/auth/email-verification";
import {
  canStartCoherenceUsage,
  recordUsageEvent,
  releaseConcurrent,
} from "@/lib/coherence/usage";

export type SearchEntitlement = {
  userId: string;
  requestId: string;
  endpoint: string;
  usageTracked: boolean;
};

/**
 * Gate product search/Ask surfaces with the same free → paid entitlement as Coherence.
 */
export async function requireSearchEntitlement(opts: {
  endpoint: string;
  searchKey: string;
  countSearch?: boolean;
}): Promise<SearchEntitlement | NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "auth_required" }, { status: 401 });
  }
  const verified = await isUserEmailVerified(user.id);
  if (!verified) {
    return NextResponse.json(
      {
        error: "email_verification_required",
        message: "Verify your email before using Legal Shaman analysis.",
      },
      { status: 403 },
    );
  }

  const requestId = `search-${Date.now().toString(36)}-${createHash("sha256")
    .update(`${user.id}:${opts.endpoint}:${opts.searchKey.slice(0, 64)}`)
    .digest("hex")
    .slice(0, 10)}`;

  const countSearch = opts.countSearch !== false;
  const allowance = await canStartCoherenceUsage({
    userId: user.id,
    requestId,
    endpoint: opts.endpoint,
    countSearch,
    searchKey: countSearch ? opts.searchKey : undefined,
  });

  if (!allowance.allowed) {
    if (allowance.reason !== "concurrent") {
      await recordUsageEvent({
        userId: user.id,
        requestId,
        endpoint: opts.endpoint,
        status: "quota_rejected",
        searchKey: countSearch ? opts.searchKey : undefined,
      });
    }
    const headers: Record<string, string> = {};
    if (allowance.retryAfterSec) headers["retry-after"] = String(allowance.retryAfterSec);
    return NextResponse.json(
      {
        error: allowance.reason ?? "quota_exceeded",
        monthlySearchUsed: allowance.monthlySearchUsed,
        monthlySearchLimit: allowance.monthlySearchLimit,
        dailyUsed: allowance.dailyUsed,
        dailyLimit: allowance.dailyLimit,
        retryAfterSec: allowance.retryAfterSec,
      },
      { status: 429, headers },
    );
  }

  if (countSearch) {
    await recordUsageEvent({
      userId: user.id,
      requestId,
      endpoint: opts.endpoint,
      status: "started",
      searchKey: opts.searchKey,
    });
  } else {
    releaseConcurrent(user.id, requestId);
  }

  return {
    userId: user.id,
    requestId,
    endpoint: opts.endpoint,
    usageTracked: countSearch,
  };
}

export async function completeSearchEntitlement(
  entitlement: SearchEntitlement,
  status: "completed" | "failed",
  searchKey?: string,
): Promise<void> {
  if (!entitlement.usageTracked) return;
  await recordUsageEvent({
    userId: entitlement.userId,
    requestId: entitlement.requestId,
    endpoint: entitlement.endpoint,
    status,
    searchKey,
  });
}
