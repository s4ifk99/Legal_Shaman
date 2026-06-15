import { getAdminSecret } from "@/lib/admin/auth";

/** Base URL for admin API calls from scripts (default local dev server). */
export function getAdminApiBaseUrl(): string {
  const base = process.env.ADMIN_API_BASE_URL?.trim() || "http://localhost:3000";
  return base.replace(/\/$/, "");
}

export function requireAdminSecretForScript(): string {
  const secret = getAdminSecret();
  if (!secret) {
    throw new Error(
      "ADMIN_SECRET is not set. Add it to .env.local or export it before running admin API scripts.",
    );
  }
  return secret;
}

/** Headers for authenticated admin API requests (no browser cookie required). */
export function adminAuthHeaders(secret?: string): Record<string, string> {
  const s = secret ?? requireAdminSecretForScript();
  return {
    "x-admin-secret": s,
    "content-type": "application/json",
  };
}

export type AdminFetchResult<T> = {
  ok: boolean;
  status: number;
  data: T;
};

/**
 * Call an admin API route with `x-admin-secret` authentication.
 * Requires the Next.js app to be running when using HTTP (ADMIN_API_BASE_URL).
 */
export async function adminFetch<T = unknown>(
  path: string,
  init?: RequestInit & { secret?: string },
): Promise<AdminFetchResult<T>> {
  const base = getAdminApiBaseUrl();
  const url = path.startsWith("http") ? path : `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const secret = init?.secret;
  const { secret: _s, ...rest } = init ?? {};

  const res = await fetch(url, {
    cache: "no-store",
    ...rest,
    headers: {
      ...adminAuthHeaders(secret),
      ...(rest.headers as Record<string, string> | undefined),
    },
  });

  const data = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, status: res.status, data };
}

export async function adminGet<T = unknown>(path: string): Promise<AdminFetchResult<T>> {
  return adminFetch<T>(path, { method: "GET" });
}

export async function adminPost<T = unknown>(
  path: string,
  body: unknown,
): Promise<AdminFetchResult<T>> {
  return adminFetch<T>(path, { method: "POST", body: JSON.stringify(body) });
}
