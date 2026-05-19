import { NextResponse } from "next/server";

import {
  SearchEventInputSchema,
  validateSearchEventBusinessRules,
} from "@/lib/search-events/types";
import { persistSearchEvent } from "@/lib/search-events/persist-event";
import { checkSearchEventRateLimit } from "@/lib/search-events/rate-limit";
import { hashSessionId } from "@/lib/search-events/privacy";

export const runtime = "nodejs";

function clientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = SearchEventInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid event payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const rateKey = `${clientIp(req)}:${hashSessionId(parsed.data.sessionId)}`;
  const limited = checkSearchEventRateLimit(rateKey);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many events" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } },
    );
  }

  const businessError = validateSearchEventBusinessRules(parsed.data);
  if (businessError) {
    return NextResponse.json({ error: businessError }, { status: 400 });
  }

  try {
    await persistSearchEvent(parsed.data);
  } catch (err) {
    console.error("[/api/search/events POST]", err);
    return NextResponse.json({ error: "Failed to record event" }, { status: 500 });
  }

  return new NextResponse(null, { status: 204 });
}
