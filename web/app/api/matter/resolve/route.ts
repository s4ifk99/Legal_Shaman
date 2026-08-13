import { NextResponse } from "next/server";

import { coherenceApiGuard, requireCoherenceAccess } from "@/lib/coherence/server/guard";
import { formatMatterInspector } from "@/lib/matter/inspector";
import { MatterEngine } from "@/lib/matter/resolve";
import { recordUsageEvent } from "@/lib/coherence/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Debug wrapper — core primitive is MatterEngine.resolve(). */
export async function POST(req: Request) {
  const blocked = coherenceApiGuard();
  if (blocked) return blocked;

  const access = await requireCoherenceAccess(req, {
    endpoint: "/api/matter/resolve",
    expectedFrontierCalls: 0,
  });
  if (access instanceof NextResponse) return access;
  const { user, requestId } = access;

  let body: {
    submission?: string;
    clientQuestion?: string;
    understanding?: string;
    jurisdictionHint?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const submission = String(body.submission || "").trim();
  if (submission.length < 8) {
    return NextResponse.json({ error: "submission too short" }, { status: 400 });
  }

  const result = MatterEngine.resolve({
    submission,
    clientQuestion: body.clientQuestion,
    understanding: body.understanding,
    jurisdictionHint: body.jurisdictionHint,
  });

  if (user.id !== "anonymous") {
    await recordUsageEvent({
      userId: user.id,
      requestId,
      endpoint: "/api/matter/resolve",
      status: "completed",
      llmCalls: 0,
    });
  }

  return NextResponse.json({
    matterFrame: result.frame,
    diagnostics: result.diagnostics,
    inspector: formatMatterInspector(result.frame),
  });
}
