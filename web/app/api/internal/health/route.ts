import { NextResponse } from "next/server";

import { enableCoherenceAskLocal } from "@/lib/coherence/mode";
import { verifyInternalCoherenceRequest } from "@/lib/coherence/server/internal-auth";
import { coherenceOpenRouterConfig, ensureCoherenceServerEnv } from "@/lib/coherence/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = verifyInternalCoherenceRequest(req);
  if (denied) return denied;

  const local = enableCoherenceAskLocal();
  let openRouter = false;
  if (local) {
    ensureCoherenceServerEnv();
    openRouter = Boolean(coherenceOpenRouterConfig().apiKey);
  }

  return NextResponse.json({
    ok: local,
    service: "coherence-internal",
    coherenceEnabled: local,
    openRouterConfigured: openRouter,
    ts: new Date().toISOString(),
  });
}
