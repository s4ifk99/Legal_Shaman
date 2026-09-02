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

function arambBackendOrigin(): string | null {
  const raw =
    process.env.ARAMB_BACKEND_ORIGIN?.trim() ||
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

export function isArambBackendConfigured(): boolean {
  return Boolean(arambBackendOrigin() && getCoherenceInternalSecret());
}

/** True when Vercel should forward Coherence LLM work to the home tunnel. */
export function shouldProxyCoherenceToHomeBackend(): boolean {
  if (process.env.VERCEL !== "1") return false;
  const v2 = (process.env.ENABLE_COHERENCE_V2 || "").trim().toLowerCase();
  if (!(v2 === "1" || v2 === "true" || v2 === "yes" || v2 === "on")) return false;
  const mode = (process.env.COHERENCE_MODE || "legacy").trim().toLowerCase();
  return mode === "v2" || mode === "shadow";
}

/** True when live SRA Postgres is unavailable on Vercel and a home backend tunnel is configured. */
export function shouldProxySraToHomeBackend(): boolean {
  return process.env.VERCEL === "1" && isCoherenceBackendConfigured();
}

/** True when Vercel should run Third Eye on the home host (legacy — skip when Exa is configured). */
export function shouldProxyArambToHomeBackend(): boolean {
  if (process.env.EXA_API_KEY?.trim()) return false
  if (process.env.VERCEL !== "1" || !isArambBackendConfigured()) return false;
  const pilot = (process.env.ENABLE_ARAMB_PILOT || "").trim().toLowerCase();
  return pilot === "1" || pilot === "true" || pilot === "yes" || pilot === "on";
}

const ARAMB_BACKEND_TIMEOUT_MS = 295_000;

export function arambBackendTimeoutMs(): number {
  return ARAMB_BACKEND_TIMEOUT_MS;
}

/** Proxy Penumbra / Aramb research to the home vnext server (Envy :3100). */
export async function proxyArambBackendPath(opts: {
  path: string;
  method?: string;
  body?: unknown;
  requestId?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  extraHeaders?: Record<string, string>;
}): Promise<Response> {
  const origin = arambBackendOrigin();
  return proxyCoherenceBackendPath({
    ...opts,
    origin: origin || undefined,
    timeoutMs: opts.timeoutMs ?? arambBackendTimeoutMs(),
  });
}

function parseSseEvents(buffer: string): { events: Array<{ event: string; data: string }>; rest: string } {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() || "";
  const events: Array<{ event: string; data: string }> = [];
  for (const block of parts) {
    const event = block.match(/^event:\s*(.+)$/m)?.[1]?.trim() || "message";
    const data = block.match(/^data:\s*(.+)$/m)?.[1]?.trim();
    if (data) events.push({ event, data });
  }
  return { events, rest };
}

/**
 * Proxy Aramb to the home host using SSE (stream:true) so Cloudflare tunnel
 * connections stay alive past the ~100s proxy idle limit, then return JSON.
 */
export async function proxyArambResearchCollect(opts: {
  body: Record<string, unknown>;
  requestId?: string;
  timeoutMs?: number;
  extraHeaders?: Record<string, string>;
}): Promise<Response> {
  const origin = arambBackendOrigin();
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

  const headers: Record<string, string> = {
    ...internalAuthHeaders(),
    "content-type": "application/json",
    accept: "text/event-stream",
    ...(opts.extraHeaders || {}),
  };
  if (opts.requestId) {
    headers[COHERENCE_INTERNAL_HEADERS.requestId] = opts.requestId;
  }

  const timeoutMs = opts.timeoutMs ?? arambBackendTimeoutMs();
  try {
    const res = await fetch(`${origin}/api/coherence/aramb/research`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...opts.body, stream: true }),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text();
      const contentType = res.headers.get("content-type") || "application/json";
      return new Response(text, { status: res.status, headers: { "content-type": contentType } });
    }
    if (!res.body) {
      return Response.json({ error: "backend_empty" }, { status: 502 });
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    let resultPayload: unknown = null;
    while (true) {
      const chunk = await reader.read();
      pending += decoder.decode(chunk.value || new Uint8Array(), { stream: !chunk.done });
      const parsed = parseSseEvents(pending);
      pending = parsed.rest;
      for (const evt of parsed.events) {
        if (evt.event === "result") {
          resultPayload = JSON.parse(evt.data) as unknown;
        }
        if (evt.event === "error") {
          const err = JSON.parse(evt.data) as { error?: string };
          return Response.json({ error: err.error || "aramb_research_failed" }, { status: 502 });
        }
      }
      if (chunk.done) break;
    }
    if (!resultPayload) {
      return Response.json({ error: "backend_no_result" }, { status: 502 });
    }
    return Response.json(resultPayload);
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
  extraHeaders?: Record<string, string>;
  /** Override COHERENCE_BACKEND_ORIGIN (e.g. ARAMB_BACKEND_ORIGIN → Envy :3100). */
  origin?: string;
}): Promise<Response> {
  const origin = (opts.origin || backendOrigin())?.replace(/\/+$/, "");
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
    ...(opts.extraHeaders || {}),
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
