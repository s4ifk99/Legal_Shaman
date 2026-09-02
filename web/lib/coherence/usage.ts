import "server-only";

import { createHash } from "node:crypto";
import { accountsPrisma } from "@/lib/db/accounts";
import { ensureBillingSchema } from "@/lib/billing/schema";
import {
  checkRateLimit,
  releaseConcurrent,
  tryAcquireConcurrent,
} from "@/lib/auth/quota-rate-limit";

export type UsageAllowance = {
  allowed: boolean;
  reason?: "daily_quota" | "monthly_search_quota" | "minute_quota" | "concurrent" | "unverified";
  retryAfterSec?: number;
  dailyUsed?: number;
  dailyLimit?: number;
  monthlySearchUsed?: number;
  monthlySearchLimit?: number;
  minuteUsed?: number;
  minuteLimit?: number;
};

export type UsageRecordInput = {
  userId: string;
  requestId: string;
  endpoint: string;
  status: "started" | "completed" | "failed" | "quota_rejected";
  llmCalls?: number;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number;
  searchKey?: string;
};

function numEnv(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function dailyLimitForPlan(plan: string, accountAgeDays: number): number {
  if (plan === "paid") return numEnv("COHERENCE_PAID_DAILY_LIMIT", 200);
  if (accountAgeDays < 7) return numEnv("COHERENCE_NEW_USER_DAILY_LIMIT", 10);
  return numEnv("COHERENCE_FREE_DAILY_LIMIT", 20);
}

function startOfUtcDay(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function startOfUtcMonth(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function stableSearchKey(value?: string): string | null {
  const text = value?.trim();
  return text ? createHash("sha256").update(`legal-shaman-search:${text}`).digest("hex") : null;
}

export async function monthlySearchUsage(userId: string): Promise<number> {
  await ensureBillingSchema();
  const searches = await accountsPrisma.usageEvent.findMany({
    where: {
      userId,
      searchKey: { not: null },
      status: { in: ["started", "completed"] },
      createdAt: { gte: startOfUtcMonth() },
    },
    select: { searchKey: true },
    distinct: ["searchKey"],
  });
  return searches.length;
}

export async function canStartCoherenceUsage(opts: {
  userId: string;
  requestId: string;
  endpoint: string;
  expectedFrontierCalls?: number;
  countSearch?: boolean;
  searchKey?: string;
}): Promise<UsageAllowance> {
  const minuteLimit = numEnv("COHERENCE_PER_MINUTE_LIMIT", 3);

  if (!tryAcquireConcurrent(opts.userId, opts.requestId)) {
    return { allowed: false, reason: "concurrent" };
  }

  try {
    await ensureBillingSchema();
  } catch (error) {
    releaseConcurrent(opts.userId, opts.requestId);
    throw error;
  }

  const minuteKey = `coherence:min:${opts.userId}`;
  const minute = checkRateLimit(minuteKey, { windowMs: 60_000, max: minuteLimit });
  if (!minute.allowed) {
    releaseConcurrent(opts.userId, opts.requestId);
    return {
      allowed: false,
      reason: "minute_quota",
      retryAfterSec: minute.retryAfterSec,
      minuteLimit,
    };
  }

  const user = await accountsPrisma.user.findUnique({
    where: { id: opts.userId },
    select: { plan: true, createdAt: true, emailVerifiedAt: true },
  });
  if (!user) {
    releaseConcurrent(opts.userId, opts.requestId);
    return { allowed: false, reason: "unverified" };
  }

  const accountAgeDays = (Date.now() - user.createdAt.getTime()) / (24 * 60 * 60 * 1000);
  const dailyLimit = dailyLimitForPlan(user.plan, accountAgeDays);
  const since = startOfUtcDay();

  const dailyUsed = await accountsPrisma.usageEvent.count({
    where: {
      userId: opts.userId,
      endpoint: { startsWith: "/api/coherence" },
      status: { in: ["started", "completed"] },
      createdAt: { gte: since },
    },
  });

  if (dailyUsed >= dailyLimit) {
    releaseConcurrent(opts.userId, opts.requestId);
    return {
      allowed: false,
      reason: "daily_quota",
      dailyUsed,
      dailyLimit,
      retryAfterSec: Math.ceil((since.getTime() + 86_400_000 - Date.now()) / 1000),
    };
  }

  const monthlySearchLimit = numEnv("COHERENCE_FREE_MONTHLY_SEARCH_LIMIT", 5);
  if (user.plan !== "paid" && opts.countSearch && stableSearchKey(opts.searchKey)) {
    const monthlySearchUsed = await monthlySearchUsage(opts.userId);
    if (monthlySearchUsed >= monthlySearchLimit) {
      releaseConcurrent(opts.userId, opts.requestId);
      return {
        allowed: false,
        reason: "monthly_search_quota",
        monthlySearchUsed,
        monthlySearchLimit,
      };
    }
    return {
      allowed: true,
      dailyUsed,
      dailyLimit,
      monthlySearchUsed,
      monthlySearchLimit,
      minuteLimit,
    };
  }

  return {
    allowed: true,
    dailyUsed,
    dailyLimit,
    monthlySearchLimit: user.plan === "paid" ? undefined : monthlySearchLimit,
    minuteLimit,
  };
}

export async function recordUsageEvent(input: UsageRecordInput): Promise<void> {
  try {
    await accountsPrisma.usageEvent.create({
      data: {
        userId: input.userId,
        requestId: input.requestId,
        endpoint: input.endpoint,
        status: input.status,
        llmCalls: input.llmCalls ?? 0,
        inputTokens: input.inputTokens ?? 0,
        outputTokens: input.outputTokens ?? 0,
        estimatedCostUsd: input.estimatedCostUsd ?? 0,
        searchKey: stableSearchKey(input.searchKey),
      },
    });
  } catch (err) {
    console.warn("[usage] record failed:", err);
  } finally {
    if (input.status !== "started") {
      releaseConcurrent(input.userId, input.requestId);
    }
  }
}

export function summarizeLlmTrace(records: {
  estimatedInputTokens?: number;
  estimatedOutputTokens?: number;
  estimatedCostUsd?: number;
}[]): {
  llmCalls: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
} {
  return {
    llmCalls: records.length,
    inputTokens: records.reduce((s, r) => s + (r.estimatedInputTokens ?? 0), 0),
    outputTokens: records.reduce((s, r) => s + (r.estimatedOutputTokens ?? 0), 0),
    estimatedCostUsd: records.reduce((s, r) => s + (r.estimatedCostUsd ?? 0), 0),
  };
}

export { releaseConcurrent };
