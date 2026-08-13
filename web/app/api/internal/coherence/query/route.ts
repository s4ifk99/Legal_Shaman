/**
 * Local backend — trusted server-to-server entry from Vercel gateway (via Cloudflare Tunnel).
 */
import { NextResponse } from "next/server";

import { enableCoherenceAskLocal } from "@/lib/coherence/mode";
import {
  COHERENCE_INTERNAL_HEADERS,
  verifyInternalCoherenceRequest,
} from "@/lib/coherence/server/internal-auth";
import { POST as executeMaster } from "@/app/api/coherence/llm/master/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(req: Request) {
  const denied = verifyInternalCoherenceRequest(req);
  if (denied) return denied;

  if (!enableCoherenceAskLocal()) {
    return NextResponse.json(
      {
        error: "backend_unavailable",
        message: "Local Coherence backend is not running (ENABLE_COHERENCE_ASK=1 required).",
      },
      { status: 503 },
    );
  }

  const requestId = req.headers.get(COHERENCE_INTERNAL_HEADERS.requestId)?.trim() || "";
  const userId = req.headers.get(COHERENCE_INTERNAL_HEADERS.userId)?.trim() || "anonymous";
  const idempotencyKey =
    req.headers.get(COHERENCE_INTERNAL_HEADERS.idempotencyKey)?.trim() || requestId;

  const body = await req.text();
  const forwardReq = new Request(new URL("/api/coherence/llm/master", req.url), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": requestId || idempotencyKey,
      "x-coherence-trusted-user-id": userId,
      "x-coherence-trusted-internal": "1",
    },
    body,
  });

  try {
    const res = await executeMaster(forwardReq);
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    return NextResponse.json(
      {
        error: "backend_error",
        message: err instanceof Error ? err.message : "Internal Coherence query failed",
      },
      { status: 500 },
    );
  }
}
