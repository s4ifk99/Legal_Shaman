import { NextResponse } from "next/server";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" } as const;

/** JSON response for admin APIs with CDN/browser caching disabled. */
export function adminJsonResponse(body: unknown, init?: ResponseInit): NextResponse {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", NO_STORE["Cache-Control"]);
  return NextResponse.json(body, { ...init, headers });
}

/** Host + database name from DATABASE_URL (no credentials). */
export function getMaskedDatabaseHost(): string | null {
  const raw = process.env.DATABASE_URL?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const host = u.hostname + (u.port ? `:${u.port}` : "");
    const db = u.pathname.replace(/^\//, "").split("?")[0] || "(no db name)";
    return `${host}/${db}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

export function getAdminRuntimeMeta(): {
  environment: string;
  vercelEnv: string | null;
  nodeEnv: string;
  databaseHost: string | null;
  fetchedAt: string;
} {
  return {
    environment:
      process.env.VERCEL_ENV?.trim() ||
      process.env.NODE_ENV?.trim() ||
      "unknown",
    vercelEnv: process.env.VERCEL_ENV?.trim() || null,
    nodeEnv: process.env.NODE_ENV?.trim() || "unknown",
    databaseHost: getMaskedDatabaseHost(),
    fetchedAt: new Date().toISOString(),
  };
}
