const SECRET_PATTERNS = [
  { name: "pem", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { name: "aws-access-key", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "aws-secret", re: /\b(?:aws_secret_access_key|aws_secret)\s*[:=]\s*['"]?[A-Za-z0-9/+=]{30,}['"]?/gi },
  { name: "github-token", re: /\b(?:ghp_|gho_|ghu_|ghs_|ghr_)[A-Za-z0-9]{20,}\b/g },
  { name: "github-pat", re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { name: "stripe", re: /\b(?:sk|rk|pk)_live_[0-9A-Za-z]{10,}\b/g },
  { name: "stripe-restricted-test", re: /\b(?:sk|rk)_test_[0-9A-Za-z]{10,}\b/g },
  { name: "slack", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: "google-api", re: /\bAIza[0-9A-Za-z\-_]{20,}\b/g },
  { name: "bearer", re: /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi },
  { name: "jwt", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { name: "openai", re: /\bsk-[A-Za-z0-9]{20,}\b/g },
  { name: "url-userinfo", re: /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/gi },
  { name: "query-secret", re: /([?&](?:token|code|password|secret|api_key|apikey|access_token)=)[^&\s"'<>]+/gi },
  { name: "assignment-secret", re: /\b((?:api[_-]?key|secret|password|token|authorization)\b\s*[:=]\s*['"])[^'"\n]{6,}(['"])/gi },
];

export function redactText(value) {
  if (value == null) return value;
  let text = String(value);
  for (const pattern of SECRET_PATTERNS) {
    pattern.re.lastIndex = 0;
    text = text.replace(pattern.re, (match, prefix, suffix) => {
      if (typeof prefix === "string" && typeof suffix === "string") {
        return `${prefix}[redacted]${suffix}`;
      }
      if (pattern.name === "query-secret") return `${prefix}[redacted]`;
      if (pattern.name === "bearer") return "Bearer [redacted]";
      return `[redacted:${pattern.name}]`;
    });
  }
  return text;
}

export function stripUrlQuery(value) {
  if (!value) return value;
  try {
    const url = new URL(String(value));
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return String(value).replace(/[?#].*$/, "");
  }
}

export function redactGitleaksReport(findings) {
  if (!Array.isArray(findings)) return [];
  return findings.map((finding) => {
    const copy = { ...finding };
    delete copy.Secret;
    delete copy.Match;
    delete copy.Fingerprint;
    if (typeof copy.Line === "string") copy.Line = "[redacted]";
    if (typeof copy.Description === "string") copy.Description = redactText(copy.Description);
    return copy;
  });
}

export function truncate(value, max = 400) {
  const text = redactText(value ?? "");
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}
