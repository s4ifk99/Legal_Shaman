const ANSI = /\u001b\[[0-9;]*m/g

const PATTERNS = [
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, to: "[REDACTED-PRIVATE-KEY]" },
  { re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, to: "[REDACTED-JWT]" },
  { re: /\b(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|gho_[A-Za-z0-9]{20,})\b/g, to: "[REDACTED]" },
  { re: /\bAKIA[0-9A-Z]{16}\b/g, to: "[REDACTED]" },
  { re: /\bsk-(?:or-|proj-|live-|test-)?[A-Za-z0-9_-]{8,}\b/g, to: "[REDACTED]" },
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, to: "[REDACTED]" },
  { re: /(postgres(?:ql)?:\/\/[^:\s/'"]+:)([^@\s'"]+)@/gi, to: "$1[REDACTED]@" },
  { re: /(mysql:\/\/[^:\s/'"]+:)([^@\s'"]+)@/gi, to: "$1[REDACTED]@" },
  { re: /(mongodb(?:\+srv)?:\/\/[^:\s/'"]+:)([^@\s'"]+)@/gi, to: "$1[REDACTED]@" },
  { re: /((?:api[_-]?key|secret|token|password|authorization|bearer)\s*[=:]\s*)(['"]?)[^\s"'&]{6,}\2/gi, to: "$1$2[REDACTED]$2" },
  { re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, to: "[REDACTED-EMAIL]" },
  { re: /(https?:\/\/[^\s"'<>]*)\?[^\s"'<>]*/g, to: "$1?[REDACTED-QUERY]" },
]

export function redactText(input, extraLiterals = []) {
  let text = String(input ?? "").replace(ANSI, "")
  for (const literal of extraLiterals) {
    if (typeof literal === "string" && literal.length >= 8) {
      text = text.split(literal).join("[REDACTED]")
    }
  }
  for (const pattern of PATTERNS) {
    text = text.replace(pattern.re, pattern.to)
  }
  return text
}
