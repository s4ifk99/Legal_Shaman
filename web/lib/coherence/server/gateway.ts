import "server-only";

import {
  COHERENCE_INTERNAL_HEADERS,
  getCoherenceInternalSecret,
  internalAuthHeaders,
} from "@/lib/coherence/server/internal-auth";

export type GatewayResult =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: string; unavailable?: boolean; message?: string };

function backendOrigin(): string | null {
  const raw =
    process.env.COHERENCE_BACKEND_ORIGIN?.trim() ||
    process.env.LEGALSHAMAN_BACKEND_ORIGIN?.trim() ||
    "";
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

function backendTimeoutMs(): number {
  const v = Number(process.env.COHERENCE_BACKEND_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : 170_000;
}

export function isCoherenceBackendConfigured(): boolean {
  return Boolean(backendOrigin() && getCoherenceInternalSecret());
}

/** True when Vercel should forward Coherence LLM work to the home tunnel. */
export function shouldProxyCoherenceToHomeBackend(): boolean {
  if (process.env.VERCEL !== "1") return false;
  const v2 = (process.env.ENABLE_COHERENCE_V2 || "").trim().toLowerCase();
  if (!(v2 === "1" || v2 === "true" || v2 === "yes" || v2 === "on")) return false;
  const mode = (process.env.COHERENCE_MODE || "legacy").trim().toLowerCase();
  return mode === "v2" || mode === "shadow";
}

/**
 * Proxy a browser-facing Coherence path to the same path on the home Next server.
 * Used for /api/coherence/llm/answer (and similar) which still expect local wiki data.
 */
export async function proxyCoherenceBackendPath(opts: {
  path: string;
  method?: string;
  body?: unknown;
  requestId?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<Response> {
  const origin = backendOrigin();
  if (!origin || !getCoherenceInternalSecret()) {
    return Response.json(
      {
        error: "backend_unavailable",
        message:
          "Legal Shaman analysis is temporarily unavailable. Your submission has been saved. Please try again shortly.",
      },
      { status: 503, headers: { "retry-after": "120" } },
    );
  }

  const path = opts.path.startsWith("/") ? opts.path : `/${opts.path}`;
  const headers: Record<string, string> = {
    ...internalAuthHeaders(),
  };
  if (opts.requestId) {
    headers[COHERENCE_INTERNAL_HEADERS.requestId] = opts.requestId;
  }

  let body: string | undefined;
  if (opts.body !== undefined && opts.method !== "GET") {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }

  try {
    const res = await fetch(`${origin}${path}`, {
      method: opts.method || "POST",
      headers,
      body,
      signal: opts.signal ?? AbortSignal.timeout(opts.timeoutMs ?? backendTimeoutMs()),
      cache: "no-store",
    });
    const text = await res.text();
    const contentType = res.headers.get("content-type") || "application/json";
    return new Response(text, {
      status: res.status,
      headers: { "content-type": contentType },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "backend_unreachable";
    const timeout = msg.toLowerCase().includes("abort") || msg.toLowerCase().includes("timeout");
    return Response.json(
      {
        error: timeout ? "backend_timeout" : "backend_unreachable",
        message:
          "Legal Shaman analysis is temporarily unavailable. Your submission has been saved. Please try again shortly.",
      },
      { status: 503, headers: { "retry-after": "120" } },
    );
  }
}

export async function checkCoherenceBackendHealth(): Promise<{
  ok: boolean;
  status?: number;
  error?: string;
}> {
  const origin = backendOrigin();
  if (!origin) {
    return { ok: false, error: "COHERENCE_BACKEND_ORIGIN not configured" };
  }
  try {
    const res = await fetch(`${origin}/api/internal/health`, {
      method: "GET",
      headers: internalAuthHeaders(),
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    if (!res.ok) {
      return { ok: false, status: res.status, error: `health ${res.status}` };
    }
    const data = (await res.json()) as { ok?: boolean };
    return { ok: Boolean(data.ok), status: res.status };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "health check failed",
    };
  }
}

export async function proxyCoherenceQuery(opts: {
  body: unknown;
  requestId: string;
  userId: string;
  idempotencyKey?: string;
  signal?: AbortSignal;
}): Promise<GatewayResult> {
  const origin = backendOrigin();
  if (!origin) {
    return {
      ok: false,
      status: 503,
      unavailable: true,
      error: "backend_not_configured",
      message: "Legal Shaman analysis backend is not configured.",
    };
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...internalAuthHeaders(),
    [COHERENCE_INTERNAL_HEADERS.requestId]: opts.requestId,
    [COHERENCE_INTERNAL_HEADERS.userId]: opts.userId,
  };
  if (opts.idempotencyKey) {
    headers[COHERENCE_INTERNAL_HEADERS.idempotencyKey] = opts.idempotencyKey;
  }

  try {
    const res = await fetch(`${origin}/api/internal/coherence/query`, {
      method: "POST",
      headers,
      body: JSON.stringify(opts.body),
      signal: opts.signal ?? AbortSignal.timeout(backendTimeoutMs()),
      cache: "no-store",
    });

    let data: unknown;
    try {
      data = await res.json();
    } catch {
      data = { error: "invalid_backend_response" };
    }

    if (!res.ok) {
      const errObj = data as { error?: string; message?: string };
      const unavailable =
        res.status === 503 ||
        res.status === 502 ||
        res.status === 504 ||
        errObj.error === "backend_unavailable";
      return {
        ok: false,
        status: unavailable ? 503 : res.status,
        unavailable,
        error: String(errObj.error || "backend_error"),
        message:
          errObj.message ||
          (unavailable
            ? "Legal Shaman analysis is temporarily unavailable. Your submission has been saved. Please try again shortly."
            : undefined),
      };
    }

    return { ok: true, status: res.status, data };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "backend_unreachable";
    const timeout = msg.toLowerCase().includes("abort") || msg.toLowerCase().includes("timeout");
    return {
      ok: false,
      status: 503,
      unavailable: true,
      error: timeout ? "backend_timeout" : "backend_unreachable",
      message:
        "Legal Shaman analysis is temporarily unavailable. Your submission has been saved. Please try again shortly.",
    };
  }
}

/** Fire-and-forget shadow comparison — never blocks the user response. */
export function fireShadowCoherenceQuery(opts: {
  body: unknown;
  requestId: string;
  userId: string;
}): void {
  void proxyCoherenceQuery(opts).then((result) => {
    if (process.env.NODE_ENV !== "production") {
      console.info("[coherence-shadow]", opts.requestId, result.ok ? "ok" : result.error);
    }
  });
}
