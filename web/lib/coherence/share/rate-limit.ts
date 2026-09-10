const hits = new Map<string, number[]>();

export function rateLimitAllow(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const prev = hits.get(key) || [];
  const recent = prev.filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}

export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return req.headers.get("x-real-ip") || "unknown";
}
