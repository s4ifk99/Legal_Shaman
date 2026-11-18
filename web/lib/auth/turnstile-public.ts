/**
 * Client-safe Turnstile helpers (no server-only imports).
 * Cloudflare always-pass test keys: https://developers.cloudflare.com/turnstile/troubleshooting/testing/
 */
export const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";
export const TURNSTILE_TEST_SECRET_KEY = "1x0000000000000000000000000000000AA";

export function isLocalAuthHost(hostname?: string | null): boolean {
  const host = (hostname || "").toLowerCase();
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host.endsWith(".localhost")
  );
}

/** Site key for the browser — test key on local hosts so CAPTCHA works without a live widget. */
export function resolveTurnstileSiteKey(hostname?: string | null): string {
  const configured = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() || "";
  if (typeof window !== "undefined" && isLocalAuthHost(window.location.hostname)) {
    return TURNSTILE_TEST_SITE_KEY;
  }
  if (hostname && isLocalAuthHost(hostname)) {
    return TURNSTILE_TEST_SITE_KEY;
  }
  return configured;
}
