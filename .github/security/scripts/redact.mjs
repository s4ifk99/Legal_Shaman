const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bsk_(?:live|test)_[0-9a-zA-Z]{8,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
  /\bBearer\s+[A-Za-z0-9\-._~+/]{12,}/gi,
  /\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*["'][^"']{6,}["']/gi,
];

export function redactText(value) {
  let text = String(value ?? "");
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, "[REDACTED]");
  }
  return text;
}

export function clip(value, max = 280) {
  const text = redactText(value).replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 15)} [truncated]`;
}
