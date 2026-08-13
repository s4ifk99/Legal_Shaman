import { NextResponse } from "next/server";

import { requireCoherenceAuthEnabled } from "@/lib/auth/coherence-auth-config";
import { isUserEmailVerified } from "@/lib/auth/email-verification";
import { getCurrentUser, type AuthenticatedUser } from "@/lib/auth/get-current-user";
import {
  checkRateLimit,
  rateLimitKeyFromRequest,
} from "@/lib/auth/quota-rate-limit";
import { verifyTurnstileToken, clientIpFromRequest } from "@/lib/auth/turnstile";
import { enableCoherenceAsk } from "@/lib/coherence/config";
import {
  canStartCoherenceUsage,
  recordUsageEvent,
  type UsageAllowance,
} from "@/lib/coherence/usage";

export type CoherenceAccessContext = {
  user: AuthenticatedUser;
  requestId: string;
  allowance: UsageAllowance;
  /** Quota already enforced on Vercel gateway — skip local usage records. */
  trustedGateway?: boolean;
};

export type CoherenceAccessOptions = {
  endpoint: string;
  captchaToken?: string | null;
  requireTurnstile?: boolean;
  expectedFrontierCalls?: number;
  /** Skip started usage event (gateway records after backend success). */
  skipUsageRecord?: boolean;
};

function quotaResponse(allowance: UsageAllowance): NextResponse {
  const headers: Record<string, string> = {};
  if (allowance.retryAfterSec) headers["retry-after"] = String(allowance.retryAfterSec);
  return NextResponse.json(
    {
      error: allowance.reason ?? "quota_exceeded",
      dailyUsed: allowance.dailyUsed,
      dailyLimit: allowance.dailyLimit,
      retryAfterSec: allowance.retryAfterSec,
    },
    { status: 429, headers },
  );
}

/**
 * Guard expensive Coherence endpoints:
 * feature flag → auth → verified email → IP rate limit → per-user quota → optional Turnstile.
 */
export async function requireCoherenceAccess(
  req: Request,
  opts: CoherenceAccessOptions,
): Promise<CoherenceAccessContext | NextResponse> {
  if (!enableCoherenceAsk()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const requestId =
    req.headers.get("x-request-id")?.trim() ||
    `coh-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const trustedGateway =
    req.headers.get("x-coherence-trusted-internal") === "1" &&
    Boolean(req.headers.get("x-coherence-trusted-user-id")?.trim());
  if (trustedGateway) {
    const trustedUserId = req.headers.get("x-coherence-trusted-user-id")!.trim();
    return {
      user: {
        id: trustedUserId,
        name: "Gateway",
        email: "",
        emailVerified: true,
      },
      requestId,
      allowance: { allowed: true },
      trustedGateway: true,
    };
  }

  if (!requireCoherenceAuthEnabled()) {
    const user = await getCurrentUser();
    if (user) {
      return {
        user,
        requestId,
        allowance: { allowed: true },
      };
    }
    return {
      user: { id: "anonymous", name: "Guest", email: "", emailVerified: true },
      requestId,
      allowance: { allowed: true },
    };
  }

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

  const ipKey = rateLimitKeyFromRequest(req, `coherence-ip:${opts.endpoint}`);
  const ipLimit = checkRateLimit(ipKey, { windowMs: 60_000, max: 30 });
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { error: "rate_limited", retryAfterSec: ipLimit.retryAfterSec },
      { status: 429, headers: { "retry-after": String(ipLimit.retryAfterSec ?? 60) } },
    );
  }

  const allowance = await canStartCoherenceUsage({
    userId: user.id,
    requestId,
    endpoint: opts.endpoint,
    expectedFrontierCalls: opts.expectedFrontierCalls ?? 2,
  });
  if (!allowance.allowed) {
    if (allowance.reason !== "concurrent") {
      await recordUsageEvent({
        userId: user.id,
        requestId,
        endpoint: opts.endpoint,
        status: "quota_rejected",
      });
    }
    return quotaResponse(allowance);
  }

  if (opts.requireTurnstile || opts.captchaToken) {
    const captcha = await verifyTurnstileToken(
      opts.captchaToken ?? "",
      clientIpFromRequest(req),
    );
    if (!captcha.ok) {
      return NextResponse.json(
        { error: captcha.error ?? "captcha_required" },
        { status: 400 },
      );
    }
  }

  if (!opts.skipUsageRecord) {
    await recordUsageEvent({
      userId: user.id,
      requestId,
      endpoint: opts.endpoint,
      status: "started",
    });
  }

  return { user, requestId, allowance };
}

/** Legacy sync guard — feature flag only (non-LLM probes). */
export function coherenceApiGuard(): NextResponse | null {
  if (enableCoherenceAsk()) return null;
  // Vercel V2 cutover: allow route modules to run (they proxy home or use OpenRouter).
  const v2 = (process.env.ENABLE_COHERENCE_V2 || "").trim().toLowerCase();
  const mode = (process.env.COHERENCE_MODE || "legacy").trim().toLowerCase();
  if (
    process.env.VERCEL === "1" &&
    (v2 === "1" || v2 === "true" || v2 === "yes" || v2 === "on") &&
    (mode === "v2" || mode === "shadow")
  ) {
    return null;
  }
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
