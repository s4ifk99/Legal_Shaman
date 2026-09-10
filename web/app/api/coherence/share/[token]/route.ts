import { NextResponse } from "next/server";

import { getShareByToken } from "@/lib/coherence/share/service";
import { clientIp, rateLimitAllow } from "@/lib/coherence/share/rate-limit";
import { shareNotesUrl, originFromRequest } from "@/lib/coherence/share/urls";

export const runtime = "nodejs";

type Params = { params: Promise<{ token: string }> };

export async function GET(req: Request, { params }: Params) {
  if (!rateLimitAllow(`share-get:${clientIp(req)}`, 120, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const { token } = await params;
  const accept = req.headers.get("accept") || "";
  if (accept.includes("text/html")) {
    return NextResponse.redirect(shareNotesUrl(originFromRequest(req), token));
  }
  const share = await getShareByToken(decodeURIComponent(token));
  if (!share) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json(share);
}
