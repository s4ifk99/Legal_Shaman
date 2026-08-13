import "server-only";

import {
  computeAdminSessionToken,
  getAdminSecret,
  parseCookieHeader,
  ADMIN_SESSION_COOKIE,
} from "@/lib/admin/auth";
import type { PublicUser } from "@/lib/auth/get-current-user";

export type CoherenceMode = "legacy" | "shadow" | "v2";
export type CoherenceUiMode = "legacy" | "coherence";

function truthyEnv(name: string): boolean {
  const v = (process.env[name] || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function parseAdminEmails(): Set<string> {
  const raw = process.env.COHERENCE_ADMIN_EMAILS?.trim() || "";
  if (!raw) return new Set();
  return new Set(
    raw
      .split(/[,;\s]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** Rollback switch — COHERENCE_MODE=legacy restores V1 Ask-the-Shaman shell. */
export function getCoherenceMode(): CoherenceMode {
  const raw = (process.env.COHERENCE_MODE || "legacy").trim().toLowerCase();
  if (raw === "shadow" || raw === "v2") return raw;
  return "legacy";
}

export function isVercelDeploy(): boolean {
  return process.env.VERCEL === "1";
}

/** Local dev intake (unchanged). */
export function enableCoherenceAskLocal(): boolean {
  if (isVercelDeploy()) return false;
  return truthyEnv("ENABLE_COHERENCE_ASK");
}

/** Production V2 shell on Vercel — ENABLE_COHERENCE_V2=true. */
export function enableCoherenceV2Deploy(): boolean {
  if (!isVercelDeploy()) return false;
  return truthyEnv("ENABLE_COHERENCE_V2");
}

/** Any Coherence API/UI beyond classic Ask. */
export function coherenceFeaturesEnabled(): boolean {
  return enableCoherenceAskLocal() || enableCoherenceV2Deploy();
}

/** Browser should call POST /api/coherence/query instead of /api/coherence/llm/master. */
export function useCoherenceQueryGateway(): boolean {
  if (truthyEnv("NEXT_PUBLIC_COHERENCE_QUERY_GATEWAY")) return true;
  if (enableCoherenceV2Deploy() && getCoherenceMode() !== "legacy") return true;
  if (enableCoherenceAskLocal() && getCoherenceMode() === "v2") return true;
  return false;
}

export function coherenceV2AdminOnly(): boolean {
  return truthyEnv("COHERENCE_V2_ADMIN_ONLY");
}

function v2Percent(): number {
  const v = Number(process.env.COHERENCE_V2_PERCENT);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.min(100, Math.floor(v));
}

/** Stable bucket 0–99 from requestId or userId for rollout sampling. */
export function coherenceSampleBucket(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i += 1) {
    h = (h * 31 + key.charCodeAt(i)) >>> 0;
  }
  return h % 100;
}

export async function isCoherenceAdmin(
  cookieHeader: string | null,
  user?: PublicUser | null,
): Promise<boolean> {
  const emails = parseAdminEmails();
  if (user?.email && emails.has(user.email.toLowerCase())) return true;

  const secret = getAdminSecret();
  if (!secret || !cookieHeader) return false;
  const cookie = parseCookieHeader(cookieHeader, ADMIN_SESSION_COOKIE);
  if (!cookie) return false;
  const token = await computeAdminSessionToken(secret);
  return cookie === token;
}

/**
 * Whether this user/request may execute via the V2 gateway (tunnel → local backend).
 * Shadow mode uses the same path for eligible samples; legacy never uses V2.
 */
export function shouldExecuteCoherenceV2(opts: {
  user?: PublicUser | null;
  requestId?: string;
  isAdmin?: boolean;
}): boolean {
  const mode = getCoherenceMode();
  if (mode === "legacy") return false;
  if (mode === "v2") {
    if (coherenceV2AdminOnly()) return Boolean(opts.isAdmin);
    if (opts.isAdmin) return true;
    const pct = v2Percent();
    if (pct >= 100) return true;
    // Local home server — always execute when mode=v2 (adapter / dev testing).
    if (!isVercelDeploy()) return true;
    const key = opts.requestId || opts.user?.id || "";
    if (!key) return false;
    if (pct <= 0) return false;
    return coherenceSampleBucket(key) < pct;
  }
  // shadow — sample/admin only (avoid doubling LLM cost for all traffic)
  if (!opts.isAdmin) {
    const pct = Math.min(v2Percent() || 10, 10);
    const key = opts.requestId || opts.user?.id || "";
    if (!key) return false;
    return coherenceSampleBucket(key) < pct;
  }
  return true;
}

/** Whether shadow comparison run should fire (background, non-blocking). */
export function shouldRunShadowComparison(opts: {
  user?: PublicUser | null;
  requestId?: string;
  isAdmin?: boolean;
}): boolean {
  if (getCoherenceMode() !== "shadow") return false;
  return shouldExecuteCoherenceV2(opts);
}

/**
 * Which shell to mount on /ask-the-shaman.
 * legacy → classic AskShamanSearch; coherence → CoherenceAskShell.
 */
export async function resolveCoherenceUi(
  cookieHeader: string | null,
  user?: PublicUser | null,
): Promise<CoherenceUiMode> {
  if (!coherenceFeaturesEnabled()) return "legacy";
  if (getCoherenceMode() === "legacy" && !enableCoherenceAskLocal()) return "legacy";

  if (enableCoherenceAskLocal()) {
    return "coherence";
  }

  // Vercel V2 deploy
  if (getCoherenceMode() === "legacy") return "legacy";

  const isAdmin = await isCoherenceAdmin(cookieHeader, user);
  if (coherenceV2AdminOnly() && !isAdmin) return "legacy";

  if (getCoherenceMode() === "v2") {
    const pct = v2Percent();
    if (pct >= 100 || isAdmin) return "coherence";
    if (!user) return "legacy";
    return coherenceSampleBucket(user.id) < pct ? "coherence" : "legacy";
  }

  // shadow — admin / sample see Coherence UI for testing
  if (isAdmin) return "coherence";
  if (user && coherenceSampleBucket(user.id) < Math.min(v2Percent() || 10, 10)) {
    return "coherence";
  }
  return "legacy";
}
