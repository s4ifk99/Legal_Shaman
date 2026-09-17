import { NextResponse } from "next/server";
import { z } from "zod";

import { revokeShare } from "@/lib/coherence/share/service";
import { clientIp, rateLimitAllow } from "@/lib/coherence/share/rate-limit";

export const runtime = "nodejs";

const BodySchema = z.object({
  updateSecret: z.string().min(16).max(128),
});

export async function POST(req: Request) {
  if (!rateLimitAllow(`share-revoke:${clientIp(req)}`, 30, 60 * 60 * 1000)) {
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

  const result = await revokeShare({ updateSecret: parsed.data.updateSecret });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true });
}
