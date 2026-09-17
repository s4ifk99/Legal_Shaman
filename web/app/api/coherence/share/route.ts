import { NextResponse } from "next/server";
import { z } from "zod";

import { createOrUpdateShare } from "@/lib/coherence/share/service";
import { clientIp, rateLimitAllow } from "@/lib/coherence/share/rate-limit";
import { originFromRequest } from "@/lib/coherence/share/urls";

export const runtime = "nodejs";

const BodySchema = z.object({
  consent: z.literal(true),
  updateSecret: z.string().min(16).max(128).optional(),
  knownPathToken: z.string().min(16).max(128).optional(),
  brief: z.record(z.unknown()),
});

export async function POST(req: Request) {
  if (!rateLimitAllow(`share-create:${clientIp(req)}`, 20, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const result = await createOrUpdateShare({
        brief: parsed.data.brief as unknown as Parameters<typeof createOrUpdateShare>[0]["brief"],
    consent: parsed.data.consent,
    origin: originFromRequest(req),
    updateSecret: parsed.data.updateSecret,
    knownPathToken: parsed.data.knownPathToken,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    url: result.url,
    updateSecret: result.updateSecret,
    expiresAt: result.expiresAt,
    publishedAt: result.publishedAt,
    created: result.created,
  });
}
