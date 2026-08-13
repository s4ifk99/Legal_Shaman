/**
 * Coherence auth gate — require signed-in verified users before expensive LLM endpoints.
 * Enable with REQUIRE_COHERENCE_AUTH=true (server) and NEXT_PUBLIC_REQUIRE_COHERENCE_AUTH=true (client).
 */
export function requireCoherenceAuthEnabled(): boolean {
  const server = process.env.REQUIRE_COHERENCE_AUTH?.trim().toLowerCase();
  const pub = process.env.NEXT_PUBLIC_REQUIRE_COHERENCE_AUTH?.trim().toLowerCase();
  const raw = server || pub;
  return raw === "1" || raw === "true" || raw === "yes";
}

/** Skip email verification in dev when email is not configured. */
export function skipEmailVerificationInDev(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  const flag = process.env.COHERENCE_SKIP_EMAIL_VERIFY?.trim().toLowerCase();
  if (flag === "0" || flag === "false") return false;
  return !process.env.RESEND_API_KEY?.trim();
}
