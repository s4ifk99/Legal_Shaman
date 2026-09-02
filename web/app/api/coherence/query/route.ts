/**
 * Vercel-facing Coherence gateway — auth, quota, requestId, proxy to local backend via tunnel.
 * Browser must only call this route (not the tunnel or /api/coherence/llm/master on Vercel).
 */
import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/get-current-user";
import {
  getCoherenceMode,
  isCoherenceAdmin,
  shouldExecuteCoherenceV2,
  shouldRunShadowComparison,
  useCoherenceQueryGateway,
} from "@/lib/coherence/mode";
import {
  checkCoherenceBackendHealth,
  fireShadowCoherenceQuery,
  isCoherenceBackendConfigured,
  proxyCoherenceQuery,
} from "@/lib/coherence/server/gateway";
import {
  canStartCoherenceUsage,
  recordUsageEvent,
  releaseConcurrent,
  summarizeLlmTrace,
} from "@/lib/coherence/usage";
import { ensureBillingSchema } from "@/lib/billing/schema";
import { requireCoherenceAuthEnabled } from "@/lib/auth/coherence-auth-config";
import { isUserEmailVerified } from "@/lib/auth/email-verification";
import {
  checkRateLimit,
  rateLimitKeyFromRequest,
} from "@/lib/auth/quota-rate-limit";
import { verifyTurnstileToken, clientIpFromRequest } from "@/lib/auth/turnstile";
import { accountsPrisma } from "@/lib/db/accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const ENDPOINT = "/api/coherence/query";

function notEnabled(): NextResponse {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

function unavailableResponse(message: string, requestId: string): NextResponse {
  return NextResponse.json(
    {
      error: "backend_unavailable",
      message,
      requestId,
      saved: true,
    },
    { status: 503, headers: { "retry-after": "120" } },
  );
}

async function duplicateRequest(requestId: string): Promise<boolean> {
  await ensureBillingSchema();
  const existing = await accountsPrisma.usageEvent.findFirst({
    where: {
      requestId,
      endpoint: ENDPOINT,
      status: { in: ["started", "completed"] },
    },
    select: { id: true },
  });
  return Boolean(existing);
}

export async function GET() {
  if (!useCoherenceQueryGateway()) return notEnabled();
  const health = await checkCoherenceBackendHealth();
  return NextResponse.json({
    gateway: true,
    mode: getCoherenceMode(),
    backendConfigured: isCoherenceBackendConfigured(),
    backendHealthy: health.ok,
    backendError: health.error,
  });
}

export async function POST(req: Request) {
  if (!useCoherenceQueryGateway()) return notEnabled();

  let body: {
    session?: Record<string, unknown>;
    latestText?: string;
    heuristicPrompt?: { id?: string; text?: string; reason?: string };
    frameIds?: string[];
    mode?: "intake" | "answer";
    captchaToken?: string;
    requestId?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const requestId =
    req.headers.get("x-request-id")?.trim() ||
    body.requestId?.trim() ||
    `coh-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const idempotencyKey =
    req.headers.get("x-idempotency-key")?.trim() || requestId;

  if (await duplicateRequest(idempotencyKey)) {
    return NextResponse.json(
      { error: "duplicate_request", requestId: idempotencyKey },
      { status: 409 },
    );
  }

  // Auth (mirror guard — quota recorded only after backend accepts work)
  let userId = "anonymous";
  if (requireCoherenceAuthEnabled()) {
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
    userId = user.id;
  } else {
    const user = await getCurrentUser();
    if (user) userId = user.id;
  }

  const cookieHeader = req.headers.get("cookie");
  const user = userId !== "anonymous" ? await getCurrentUser() : null;
  const isAdmin = await isCoherenceAdmin(cookieHeader, user);

  const mode = getCoherenceMode();
  if (mode === "legacy") {
    return NextResponse.json(
      { error: "legacy_mode", message: "Coherence V2 gateway is disabled in legacy mode." },
      { status: 404 },
    );
  }

  const runV2 = shouldExecuteCoherenceV2({ user, requestId, isAdmin });
  if (!runV2) {
    return NextResponse.json(
      {
        error: "not_in_rollout",
        message: "Coherence V2 is not enabled for this account yet.",
        mode,
      },
      { status: 403 },
    );
  }

  const ipKey = rateLimitKeyFromRequest(req, `coherence-ip:query`);
  const ipLimit = checkRateLimit(ipKey, { windowMs: 60_000, max: 30 });
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { error: "rate_limited", retryAfterSec: ipLimit.retryAfterSec },
      { status: 429, headers: { "retry-after": String(ipLimit.retryAfterSec ?? 60) } },
    );
  }

  if (body.captchaToken) {
    const captcha = await verifyTurnstileToken(body.captchaToken, clientIpFromRequest(req));
    if (!captcha.ok) {
      return NextResponse.json({ error: captcha.error ?? "captcha_required" }, { status: 400 });
    }
  }

  const allowance = await canStartCoherenceUsage({
    userId,
    requestId: idempotencyKey,
    endpoint: ENDPOINT,
    expectedFrontierCalls: 2,
  });
  if (!allowance.allowed) {
    if (allowance.reason !== "concurrent") {
      await recordUsageEvent({
        userId,
        requestId: idempotencyKey,
        endpoint: ENDPOINT,
        status: "quota_rejected",
      });
    }
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

  if (!isCoherenceBackendConfigured()) {
    releaseConcurrent(userId, idempotencyKey);
    return unavailableResponse(
      "Legal Shaman analysis is temporarily unavailable. Your submission has been saved. Please try again shortly.",
      requestId,
    );
  }

  // Shadow on local dev: legacy in-process path answers user; V2 runs for comparison only.
  if (mode === "shadow" && !process.env.VERCEL) {
    releaseConcurrent(userId, idempotencyKey);
    if (shouldRunShadowComparison({ user, requestId, isAdmin })) {
      fireShadowCoherenceQuery({
        body,
        requestId: `${requestId}-shadow`,
        userId,
      });
    }
    const { POST: legacyMaster } = await import("@/app/api/coherence/llm/master/route");
    const legacyReq = new Request(req.url, {
      method: "POST",
      headers: req.headers,
      body: JSON.stringify(body),
    });
    return legacyMaster(legacyReq);
  }

  const proxied = await proxyCoherenceQuery({
    body,
    requestId,
    userId,
    idempotencyKey,
    signal: req.signal,
  });

  if (!proxied.ok) {
    releaseConcurrent(userId, idempotencyKey);
    if (proxied.unavailable) {
      return unavailableResponse(
        proxied.message ||
          "Legal Shaman analysis is temporarily unavailable. Your submission has been saved. Please try again shortly.",
        requestId,
      );
    }
    return NextResponse.json(
      { error: proxied.error, message: proxied.message, requestId },
      { status: proxied.status },
    );
  }

  const data = proxied.data as Record<string, unknown>;
  const llmTrace = data.llmTrace as { records?: unknown[] } | undefined;

  if (userId !== "anonymous") {
    await recordUsageEvent({
      userId,
      requestId: idempotencyKey,
      endpoint: ENDPOINT,
      status: "started",
    });
    const summary = summarizeLlmTrace(
      (llmTrace?.records as Parameters<typeof summarizeLlmTrace>[0]) || [],
    );
    await recordUsageEvent({
      userId,
      requestId: idempotencyKey,
      endpoint: ENDPOINT,
      status: "completed",
      ...summary,
    });
  } else {
    releaseConcurrent(userId, idempotencyKey);
  }

  return NextResponse.json({ ...data, requestId, gateway: true });
}
