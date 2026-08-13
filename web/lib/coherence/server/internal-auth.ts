import "server-only";

import { NextResponse } from "next/server";

const HEADER = "x-coherence-internal-secret";

export function getCoherenceInternalSecret(): string | undefined {
  const v = process.env.COHERENCE_INTERNAL_SECRET?.trim();
  return v || undefined;
}

export function internalAuthHeaders(): Record<string, string> {
  const secret = getCoherenceInternalSecret();
  if (!secret) return {};
  return { [HEADER]: secret };
}

export function verifyInternalCoherenceRequest(req: Request): NextResponse | null {
  const expected = getCoherenceInternalSecret();
  if (!expected) {
    return NextResponse.json(
      { error: "internal_not_configured", message: "COHERENCE_INTERNAL_SECRET is not set." },
      { status: 503 },
    );
  }
  const got = req.headers.get(HEADER)?.trim();
  if (got !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

export const COHERENCE_INTERNAL_HEADERS = {
  userId: "x-coherence-user-id",
  requestId: "x-request-id",
  idempotencyKey: "x-idempotency-key",
} as const;
