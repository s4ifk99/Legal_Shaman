import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentUser } from "@/lib/auth/get-current-user";
import { sendTriageFeedbackSummary } from "@/lib/triage-feedback/send-summary";
import type { TriageResultSection } from "@/lib/legal-search/triage/types";

export const runtime = "nodejs";

const SectionSchema = z.object({
  kind: z.enum(["legal_aid", "pro_bono", "private"]),
  title: z.string(),
  results: z.array(z.object({ id: z.string() }).passthrough()),
});

const BodySchema = z.object({
  sessionId: z.string().trim().min(1).max(128),
  email: z.string().trim().email().max(255),
  reviewConsent: z.literal(true),
  mergedQuery: z.string().trim().min(1).max(800),
  sections: z.array(SectionSchema).min(1),
});

/**
 * POST /api/triage/send-summary
 * Send triage results summary to the user; BCC Trustpilot AFS when reviewConsent is true.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const user = await getCurrentUser();

  const result = await sendTriageFeedbackSummary({
    sessionId: parsed.data.sessionId,
    email: parsed.data.email,
    reviewConsent: parsed.data.reviewConsent,
    mergedQuery: parsed.data.mergedQuery,
    sections: parsed.data.sections as TriageResultSection[],
    recipientName: user?.name,
    userId: user?.id,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status ?? 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    alreadySent: result.alreadySent ?? false,
  });
}
