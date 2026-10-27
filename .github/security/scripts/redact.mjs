const ASSIGNMENT =
  /((?:api[_-]?key|secret|token|password|authorization|credential)\s*[=:]\s*)(['"]?)[^\s'"]{6,}\2/gi;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/-]{8,}/gi;
const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
const KNOWN_PREFIX =
  /\b(?:sk_live|sk_test|rk_live|rk_test|ghp_|github_pat_|xox[baprs]-|AKIA|AIza|ya29\.)[A-Za-z0-9_\-]{8,}\b/g;

export function redactText(input) {
  let text = String(input ?? "");
  text = text.replace(PRIVATE_KEY, "[REDACTED]");
  text = text.replace(KNOWN_PREFIX, "[REDACTED]");
  text = text.replace(BEARER, "Bearer [REDACTED]");
  text = text.replace(ASSIGNMENT, (_match, prefix, quote) => `${prefix}${quote ?? ""}[REDACTED]${quote ?? ""}`);
  return text;
}
