import "server-only";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export function checkRateLimit(
  key: string,
  opts: { windowMs: number; max: number },
): { allowed: boolean; retryAfterSec?: number } {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + opts.windowMs };
    buckets.set(key, bucket);
  }
  if (bucket.count >= opts.max) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }
  bucket.count += 1;
  buckets.set(key, bucket);
  return { allowed: true };
}

export function rateLimitKeyFromRequest(req: Request, prefix: string): string {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  return `${prefix}:${ip}`;
}

/** Per-user in-flight expensive requests (single-instance; use Redis for multi-node). */
const inFlight = new Map<string, string>();

export function tryAcquireConcurrent(userId: string, requestId: string): boolean {
  const existing = inFlight.get(userId);
  if (existing && existing !== requestId) return false;
  inFlight.set(userId, requestId);
  return true;
}

export function releaseConcurrent(userId: string, requestId: string): void {
  if (inFlight.get(userId) === requestId) inFlight.delete(userId);
}
