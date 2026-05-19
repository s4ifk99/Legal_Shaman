import { createHash } from "node:crypto";

const QUERY_PREFIX_MAX = 80;

export function queryPrefix(query: string, max = QUERY_PREFIX_MAX): string {
  const t = query.trim().replace(/\s+/g, " ");
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

/** One-way session fingerprint — raw sessionId is not stored. */
export function hashSessionId(sessionId: string): string {
  const salt = process.env.SEARCH_EVENT_SALT ?? "signpost-search-events-dev";
  return createHash("sha256").update(`${salt}:${sessionId.trim()}`).digest("hex");
}

/** Strip fields that must not appear in metadata. */
export function sanitizeEventMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  const out: Record<string, unknown> = {};
  const banned = new Set([
    "email",
    "phone",
    "rawQuery",
    "query",
    "name",
    "address",
    "postcode",
  ]);
  for (const [k, v] of Object.entries(metadata)) {
    if (banned.has(k.toLowerCase())) continue;
    if (typeof v === "string" && v.length > 200) {
      out[k] = v.slice(0, 200);
    } else if (typeof v === "number" || typeof v === "boolean" || v === null) {
      out[k] = v;
    } else if (typeof v === "string") {
      out[k] = v;
    }
  }
  return Object.keys(out).length ? out : undefined;
}
