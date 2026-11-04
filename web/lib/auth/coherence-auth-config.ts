/**
 * Coherence auth gate — optional sign-in before expensive LLM endpoints.
 * Off by default (aligned with Nov Exp 2 search-before-signup). Opt in with
 * REQUIRE_COHERENCE_AUTH=true / NEXT_PUBLIC_REQUIRE_COHERENCE_AUTH=true.
 */
export function requireCoherenceAuthEnabled(): boolean {
  const server = process.env.REQUIRE_COHERENCE_AUTH?.trim().toLowerCase();
  const pub = process.env.NEXT_PUBLIC_REQUIRE_COHERENCE_AUTH?.trim().toLowerCase();
  const raw = server || pub;
  if (!raw) return false;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  return raw === "1" || raw === "true" || raw === "yes";
}

/** Skip email verification in dev when email is not configured. */
export function skipEmailVerificationInDev(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  const flag = process.env.COHERENCE_SKIP_EMAIL_VERIFY?.trim().toLowerCase();
  if (flag === "0" || flag === "false") return false;
  return !process.env.RESEND_API_KEY?.trim();
}
