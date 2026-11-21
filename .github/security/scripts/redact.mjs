const EXACT = ["5ar5K5mpXwwkcFGOTKH51Q"];

const PATTERNS = [
  [/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, "[REDACTED]"],
  [/\bsk-(?:live|test|proj|or|ant)-[A-Za-z0-9_-]{8,}/g, "[REDACTED]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED]"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "[REDACTED]"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "[REDACTED]"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, "[REDACTED]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [REDACTED]"],
  [/((?:set-cookie|cookie|authorization)\s*[:=]\s*)([^\r\n;]+)/gi, "$1[REDACTED]"],
  [/((?:api[_-]?key|secret|token|password|passwd|pwd)\s*[:=]\s*['"]?)([^\s'"]{6,})/gi, "$1[REDACTED]"],
];

export function redact(value) {
  if (value == null) return "";
  let text = String(value);
  for (const exact of EXACT) {
    if (exact && text.includes(exact)) text = text.split(exact).join("[REDACTED]");
  }
  for (const [pattern, replacement] of PATTERNS) {
    text = text.replace(pattern, replacement);
  }
  return text;
}

export function redactValue(value) {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = redactValue(item);
    return out;
  }
  return value;
}

export function clip(value, max = 700) {
  const text = redact(value).replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}
