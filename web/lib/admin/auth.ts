/**
 * Admin gate: set ADMIN_SECRET in production. API accepts `x-admin-secret` header
 * or `admin_session` cookie (set via POST /api/admin/session after login).
 */

const SESSION_SALT = "signpost-admin-v1";

/** HttpOnly cookie set after POST /api/admin/session (same value as header auth for APIs). */
export const ADMIN_SESSION_COOKIE = "admin_session";

export function getAdminSecret(): string | undefined {
  const v = process.env.ADMIN_SECRET?.trim();
  return v || undefined;
}

export function isProductionNodeEnv(): boolean {
  return process.env.NODE_ENV === "production";
}

/** Dev with no secret: pages/API are open (see layout warning). */
export function isAdminDevUnprotected(): boolean {
  return !isProductionNodeEnv() && !getAdminSecret();
}

/** Prod deploy without secret — block everything sensitive. */
export function isAdminMisconfiguredProduction(): boolean {
  return isProductionNodeEnv() && !getAdminSecret();
}

export async function computeAdminSessionToken(secret: string): Promise<string> {
  const data = new TextEncoder().encode(`${SESSION_SALT}|${secret}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function parseCookieHeader(cookieHeader: string | null, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const p = part.trim();
    const i = p.indexOf("=");
    if (i === -1) continue;
    const k = p.slice(0, i).trim();
    const v = p.slice(i + 1).trim();
    if (k === name) {
      try {
        return decodeURIComponent(v);
      } catch {
        return v;
      }
    }
  }
  return undefined;
}

/**
 * Returns a JSON Response if the request must be rejected; otherwise null.
 * - Production without ADMIN_SECRET → 503
 * - Dev without secret → allow (optional warning header on response — caller adds)
 * - When secret is set → require matching `x-admin-secret` OR `admin_session` cookie
 */
export async function requireAdminApiRequest(request: Request): Promise<Response | null> {
  if (isAdminMisconfiguredProduction()) {
    return Response.json(
      { error: "ADMIN_SECRET is not configured; admin APIs are disabled in production." },
      { status: 503 },
    );
  }

  const secret = getAdminSecret();
  if (!secret) {
    return null;
  }

  const header = request.headers.get("x-admin-secret");
  const cookie = parseCookieHeader(request.headers.get("cookie"), ADMIN_SESSION_COOKIE);
  const token = await computeAdminSessionToken(secret);
  const ok = header === secret || cookie === token;

  if (!ok) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}

export const ADMIN_DEV_WARNING_HEADER = "x-admin-auth-warning";

export function adminDevWarningValue(): string {
  return "development-without-admin-secret";
}
