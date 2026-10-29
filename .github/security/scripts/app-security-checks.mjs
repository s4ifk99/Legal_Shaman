import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { clip } from "./redact.mjs";

const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "data", "coverage", "out"]);
const SOURCE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

function relPath(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function lineAt(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) if (text[i] === "\n") line += 1;
  return line;
}

function walk(dir, root, acc) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    if (entry.name === ".env" || (entry.name.startsWith(".env.") && entry.name !== ".env.example")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, root, acc);
      continue;
    }
    if (!entry.isFile()) continue;
    if (entry.name.endsWith(".pem") || entry.name.endsWith(".key")) continue;
    const ext = path.extname(entry.name);
    if (!SOURCE_EXT.has(ext) && entry.name !== "next.config.mjs") continue;
    const stat = fs.statSync(full);
    if (stat.size > 1_000_000) continue;
    acc.push(full);
  }
  return acc;
}

function finding(partial) {
  return {
    ruleId: partial.ruleId,
    severity: partial.severity,
    category: partial.category,
    location: partial.location,
    line: partial.line ?? null,
    evidence: clip(partial.evidence),
    suggestedFix: partial.suggestedFix,
  };
}

function scanDangerousHtml(text, rel, findings) {
  const marker = "dangerouslySetInnerHTML";
  let from = 0;
  let saw = false;
  while (from < text.length) {
    const index = text.indexOf(marker, from);
    if (index === -1) break;
    saw = true;
    const window = text.slice(index, index + 500);
    const htmlIndex = window.indexOf("__html");
    const snippet = htmlIndex === -1 ? window : window.slice(htmlIndex, htmlIndex + 240);
    const literal = /__html\s*:\s*(?:"[^"]*"|'[^']*'|`[^`$]*`)/.test(snippet);
    if (!literal) {
      findings.push(
        finding({
          ruleId: "xss-dangerous-html",
          severity: "high",
          category: "xss",
          location: rel,
          line: lineAt(text, index),
          evidence: "dangerouslySetInnerHTML uses a non-literal HTML value",
          suggestedFix:
            "Escape untrusted values before writing HTML, or keep the snippet a constant. For CSS variables, allow only hex colors and CSS.escape the selector id.",
        }),
      );
    }
    from = index + marker.length;
  }
  return saw;
}

function scanInnerHtml(text, rel, findings) {
  if (!rel.startsWith("static-site/")) return;
  const re = /innerHTML\s*=\s*`([^`]*)`/g;
  let match;
  while ((match = re.exec(text))) {
    const body = match[1];
    const exprs = [...body.matchAll(/\$\{([^}]+)\}/g)].map((item) => item[1]);
    for (const expr of exprs) {
      if (/escapeHtml|encodeURIComponent/.test(expr)) continue;
      if (!/\bservice\.(title|summary|url|cta|category|coverage|contact)\b|\b(query|params|userInput)\b/.test(expr)) {
        continue;
      }
      findings.push(
        finding({
          ruleId: "xss-innerhtml",
          severity: "high",
          category: "xss",
          location: rel,
          line: lineAt(text, match.index),
          evidence: `innerHTML template interpolates ${expr.trim()} without escapeHtml`,
          suggestedFix: "Pass the value through escapeHtml before inserting it into innerHTML.",
        }),
      );
    }
  }
}

function argumentRegion(text, index, name) {
  let i = index + name.length;
  if (text[i] === "<") {
    let depth = 0;
    const limit = Math.min(text.length, i + 300);
    for (; i < limit; i += 1) {
      if (text[i] === "<") depth += 1;
      else if (text[i] === ">") {
        depth -= 1;
        if (depth === 0) {
          i += 1;
          break;
        }
      }
    }
  }
  while (i < text.length && /\s/.test(text[i])) i += 1;
  if (text[i] === "(") i += 1;
  while (i < text.length && /\s/.test(text[i])) i += 1;
  const start = i;
  const quote = text[i];
  if (quote === "`" || quote === '"' || quote === "'") {
    i += 1;
    while (i < text.length && i < start + 2500) {
      if (text[i] === "\\") {
        i += 2;
        continue;
      }
      if (quote === "`" && text[i] === "$" && text[i + 1] === "{") {
        i += 2;
        let depth = 1;
        while (i < text.length && depth > 0) {
          if (text[i] === "{") depth += 1;
          else if (text[i] === "}") depth -= 1;
          i += 1;
        }
        continue;
      }
      if (text[i] === quote) {
        i += 1;
        break;
      }
      i += 1;
    }
    return text.slice(start, i);
  }
  let depth = 0;
  const limit = Math.min(text.length, i + 400);
  for (; i < limit; i += 1) {
    const ch = text[i];
    if (ch === "(") depth += 1;
    else if (ch === ")" && depth === 0) break;
    else if (ch === ")") depth -= 1;
    else if (ch === "," && depth === 0) break;
  }
  return text.slice(start, i);
}

function scanSql(text, rel, findings) {
  const names = ["$queryRawUnsafe", "$executeRawUnsafe"];
  for (const name of names) {
    let from = 0;
    while (from < text.length) {
      const index = text.indexOf(name, from);
      if (index === -1) break;
      const region = argumentRegion(text, index, name);
      const interpolated = [...region.matchAll(/\$\{([^}]+)\}/g)].map((item) => item[1].trim());
      const literal = region.startsWith("`") || region.startsWith('"') || region.startsWith("'");
      const dynamic = interpolated.length > 0 || !literal;
      if (dynamic) {
        const userControlled = interpolated.some((expr) =>
          /\b(req|request|body|params|searchParams|formData|userInput|input)\b/.test(expr),
        );
        findings.push(
          finding({
            ruleId: userControlled ? "sql-injection-user-input" : "sql-dynamic-raw",
            severity: userControlled ? "critical" : "medium",
            category: "injection",
            location: rel,
            line: lineAt(text, index),
            evidence: interpolated.length
              ? `${name} interpolates ${interpolated.join(", ")}`
              : `${name} is called with a dynamic SQL string`,
            suggestedFix: userControlled
              ? "Do not build SQL from request data. Use Prisma query parameters or Prisma.sql bound values."
              : "Keep raw SQL as a literal, or bind values with Prisma.sql. If a fragment must be dynamic, restrict it to a fixed allowlist and coerce integers before interpolation.",
          }),
        );
      }
      from = index + name.length;
    }
  }
  if (text.includes("Prisma.raw(")) {
    const index = text.indexOf("Prisma.raw(");
    findings.push(
      finding({
        ruleId: "sql-prisma-raw",
        severity: "medium",
        category: "injection",
        location: rel,
        line: lineAt(text, index),
        evidence: "Prisma.raw bypasses parameter binding",
        suggestedFix:
          "Keep Prisma.raw fragments as developer-controlled constants. Pass user values only as Prisma.sql parameters.",
      }),
    );
  }
}

const TIMING_FILES = new Set([
  "web/lib/admin/auth.ts",
  "web/app/api/admin/session/route.ts",
  "web/lib/coherence/server/internal-auth.ts",
  "web/lib/coherence/server/guard.ts",
  "web/lib/auth/user-session.ts",
  "web/app/api/billing/revenuecat-webhook/route.ts",
]);

export function runAppChecks(rootDir) {
  const findings = [];
  const passed = [];
  const files = walk(rootDir, rootDir, []);
  const configPath = path.join(rootDir, "web/next.config.mjs");
  if (fs.existsSync(configPath)) {
    const text = fs.readFileSync(configPath, "utf8");
    const rel = "web/next.config.mjs";
    const required = [
      "Content-Security-Policy",
      "Strict-Transport-Security",
      "X-Content-Type-Options",
      "Referrer-Policy",
      "X-Frame-Options",
    ];
    const missing = required.filter((header) => !text.includes(header));
    if (missing.length) {
      findings.push(
        finding({
          ruleId: "missing-security-headers",
          severity: "medium",
          category: "insecure-configuration",
          location: rel,
          line: 1,
          evidence: `next.config.mjs does not set ${missing.join(", ")}`,
          suggestedFix:
            "Add a headers() function with those response headers. Keep a narrow frame-ancestors exception only for the intentional embed route.",
        }),
      );
    } else {
      passed.push({ id: "security-headers", summary: "Baseline security headers are configured." });
    }
    if (/ignoreBuildErrors\s*:\s*true/.test(text)) {
      findings.push(
        finding({
          ruleId: "ignore-build-errors",
          severity: "medium",
          category: "insecure-configuration",
          location: rel,
          line: lineAt(text, text.search(/ignoreBuildErrors\s*:\s*true/)),
          evidence: "typescript.ignoreBuildErrors is true",
          suggestedFix: "Set ignoreBuildErrors to false so type errors cannot hide broken security checks.",
        }),
      );
    }
  } else {
    findings.push(
      finding({
        ruleId: "missing-next-config",
        severity: "high",
        category: "insecure-configuration",
        location: "web/next.config.mjs",
        line: null,
        evidence: "web/next.config.mjs is missing",
        suggestedFix: "Restore the Next.js config and set baseline security headers.",
      }),
    );
  }

  let adminRoutes = 0;
  let adminGuarded = 0;
  for (const file of files) {
    const rel = relPath(rootDir, file);
    const text = fs.readFileSync(file, "utf8");

    if (/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(text)) {
      findings.push(
        finding({
          ruleId: "private-key-block",
          severity: "critical",
          category: "exposed-api-key",
          location: rel,
          line: lineAt(text, text.search(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/)),
          evidence: "Private key block found. The value is redacted.",
          suggestedFix: "Remove the key from the tree and rotate it. Git history is not part of this scan.",
        }),
      );
    }
    const publicSecret = [
      ...text.matchAll(/process\.env\.(NEXT_PUBLIC_[A-Z0-9_]*(?:SECRET|PASSWORD|PRIVATE|CREDENTIAL)[A-Z0-9_]*)/g),
    ];
    for (const match of publicSecret) {
      findings.push(
        finding({
          ruleId: "public-env-secret",
          severity: "critical",
          category: "exposed-api-key",
          location: rel,
          line: lineAt(text, match.index),
          evidence: `${match[1]} is a NEXT_PUBLIC variable with a secret-like name`,
          suggestedFix: "Do not put secrets in NEXT_PUBLIC variables. They are shipped to the browser.",
        }),
      );
    }
    if (/\bsk-(?:live|proj|ant)-[A-Za-z0-9_-]{16,}/.test(text)) {
      findings.push(
        finding({
          ruleId: "hardcoded-secret-token",
          severity: "critical",
          category: "exposed-api-key",
          location: rel,
          line: lineAt(text, text.search(/\bsk-(?:live|proj|ant)-[A-Za-z0-9_-]{16,}/)),
          evidence: "Hardcoded secret token pattern. The value is redacted.",
          suggestedFix: "Remove the token from source and rotate it. Read it from the server environment.",
        }),
      );
    }
    if (/NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0['"]?/.test(text)) {
      findings.push(
        finding({
          ruleId: "tls-verification-disabled",
          severity: "high",
          category: "insecure-configuration",
          location: rel,
          line: lineAt(text, text.search(/NODE_TLS_REJECT_UNAUTHORIZED/)),
          evidence: "TLS certificate verification is disabled",
          suggestedFix: "Remove NODE_TLS_REJECT_UNAUTHORIZED=0.",
        }),
      );
    }

    const dynamicHtml = scanDangerousHtml(text, rel, findings);
    if (dynamicHtml && rel === "web/components/analytics/ahrefs-analytics.tsx") {
      passed.push({
        id: "ahrefs-snippet",
        summary: "Ahrefs analytics snippet is a constant. The public site key is not treated as an application secret.",
      });
    }
    scanInnerHtml(text, rel, findings);
    scanSql(text, rel, findings);

    if (rel.startsWith("web/app/api/admin/") && rel.endsWith("/route.ts")) {
      if (rel.endsWith("/admin/session/route.ts")) {
        const cookieOk = /httpOnly:\s*true/.test(text) && /sameSite:\s*"lax"/.test(text) && /secure:/.test(text);
        if (!cookieOk) {
          findings.push(
            finding({
              ruleId: "admin-cookie-flags",
              severity: "high",
              category: "authentication",
              location: rel,
              line: 1,
              evidence: "Admin session cookie is missing httpOnly, SameSite, or the secure flag",
              suggestedFix: "Set httpOnly, SameSite=lax, and secure in production on the admin session cookie.",
            }),
          );
        } else {
          passed.push({ id: "admin-session-cookie", summary: "Admin session cookie sets httpOnly, SameSite, and secure." });
        }
      } else {
        adminRoutes += 1;
        if (text.includes("requireAdminApiRequest")) {
          adminGuarded += 1;
        } else {
          findings.push(
            finding({
              ruleId: "admin-route-missing-auth",
              severity: "high",
              category: "authorisation",
              location: rel,
              line: 1,
              evidence: "Admin API route does not call requireAdminApiRequest",
              suggestedFix:
                "Call requireAdminApiRequest at the start of every handler. Middleware is a second layer, not a replacement.",
            }),
          );
        }
      }
    }

    if (rel === "web/lib/auth/user-session.ts") {
      const cookieOk = /httpOnly:\s*true/.test(text) && /sameSite:\s*"lax"/.test(text) && /secure:/.test(text);
      if (!cookieOk) {
        findings.push(
          finding({
            ruleId: "user-cookie-flags",
            severity: "high",
            category: "authentication",
            location: rel,
            line: 1,
            evidence: "User session cookie is missing httpOnly, SameSite, or the secure flag",
            suggestedFix: "Set httpOnly, SameSite=lax, and secure in production on the user session cookie.",
          }),
        );
      } else {
        passed.push({ id: "user-session-cookie", summary: "User session cookie sets httpOnly, SameSite, and secure." });
      }
    }

    if (text.includes('headers.get("x-coherence-trusted-user-id")') || text.includes("headers.get('x-coherence-trusted-user-id')")) {
      if (!/x-coherence-internal-secret|getCoherenceInternalSecret/.test(text)) {
        findings.push(
          finding({
            ruleId: "trusted-user-header",
            severity: "critical",
            category: "authorisation",
            location: rel,
            line: lineAt(text, text.indexOf("x-coherence-trusted-user-id")),
            evidence: "Trusted user header is read without the internal secret check in this file",
            suggestedFix: "Reject the trusted user header unless x-coherence-internal-secret matches COHERENCE_INTERNAL_SECRET.",
          }),
        );
      } else {
        passed.push({
          id: `trusted-header-${rel}`,
          summary: `${rel} checks the internal secret before honouring the trusted user header.`,
        });
      }
    }

    if (/console\.(log|info|debug|warn)\([^\n]*reset URL/.test(text)) {
      const index = text.search(/console\.(log|info|debug|warn)\([^\n]*reset URL/);
      findings.push(
        finding({
          ruleId: "password-reset-link-logged",
          severity: "high",
          category: "sensitive-data",
          location: rel,
          line: lineAt(text, index),
          evidence: "Password reset URL is written to the log when email is not configured",
          suggestedFix:
            "Do not log the reset link. If email is not configured, return a generic failure and do not create a usable token.",
        }),
      );
    }

    if (/rawQuery:\s*[^,\n]*\bquery\b/.test(text)) {
      findings.push(
        finding({
          ruleId: "raw-query-stored",
          severity: "medium",
          category: "sensitive-data",
          location: rel,
          line: lineAt(text, text.search(/rawQuery:\s*[^,\n]*\bquery\b/)),
          evidence: "A search query is stored in rawQuery and may contain personal details",
          suggestedFix: "Store a hash or a short redacted prefix instead of the full query text.",
        }),
      );
    }

    if (/\bnew Function\s*\(/.test(text)) {
      findings.push(
        finding({
          ruleId: "function-constructor",
          severity: "medium",
          category: "injection",
          location: rel,
          line: lineAt(text, text.search(/\bnew Function\s*\(/)),
          evidence: "Function constructor is used for dynamic import",
          suggestedFix: "Replace it with a static import map of known module filenames.",
        }),
      );
    }

    if (rel.includes("/app/api/billing/") && rel.includes("webhook") && rel.endsWith("/route.ts")) {
      const checksSecret = /constructEvent|WEBHOOK_SECRET|authorization/.test(text);
      const failsClosed = /if\s*\(\s*!/.test(text) && /secret/.test(text);
      if (!checksSecret || !failsClosed) {
        findings.push(
          finding({
            ruleId: "webhook-signature",
            severity: "high",
            category: "authentication",
            location: rel,
            line: 1,
            evidence: "Billing webhook does not show a signature or shared-secret check that fails closed",
            suggestedFix: "Verify the provider signature or bearer secret and reject the request when it is missing.",
          }),
        );
      } else {
        passed.push({ id: `webhook-${rel}`, summary: `${rel} checks a webhook secret before accepting the event.` });
      }
    }

    if (rel.startsWith("web/app/api/auth/") && rel.endsWith("/route.ts") && /export async function POST/.test(text)) {
      if (!rel.endsWith("/logout/route.ts") && !text.includes("checkAuthRateLimit")) {
        findings.push(
          finding({
            ruleId: "auth-post-without-rate-limit",
            severity: "medium",
            category: "authentication",
            location: rel,
            line: lineAt(text, text.search(/export async function POST/)),
            evidence: "Auth POST handler does not call checkAuthRateLimit",
            suggestedFix: "Rate limit credential and token endpoints before doing other work.",
          }),
        );
      }
    }

    if (TIMING_FILES.has(rel)) {
      const lines = text.split("\n");
      const hit = lines.findIndex((line) => {
        if (line.trim().startsWith("//") || line.trim().startsWith("*")) return false;
        return /(?:password|secret|authorization|got|mac|expected)\s*(?:!==|===)|(?:!==|===)\s*(?:password|secret|expected|mac)/.test(
          line,
        );
      });
      if (hit !== -1) {
        findings.push(
          finding({
            ruleId: "timing-unsafe-compare",
            severity: "medium",
            category: "authentication",
            location: rel,
            line: hit + 1,
            evidence: "Secret or token is compared with === or !==",
            suggestedFix: "Compare equal-length digests with crypto.timingSafeEqual.",
          }),
        );
      }
    }

    if (/(?:NextResponse|Response)\.json\(/.test(text) && /passwordHash\s*:/.test(text)) {
      const jsonAt = text.search(/(?:NextResponse|Response)\.json\(/);
      const nearby = text.slice(jsonAt, jsonAt + 500);
      if (/passwordHash\s*:/.test(nearby)) {
        findings.push(
          finding({
            ruleId: "password-hash-response",
            severity: "critical",
            category: "sensitive-data",
            location: rel,
            line: lineAt(text, jsonAt),
            evidence: "A JSON response includes passwordHash",
            suggestedFix: "Never return passwordHash. Return hasPassword or omit the field.",
          }),
        );
      }
    }

    if (/frame-ancestors\s+\*/.test(text)) {
      findings.push(
        finding({
          ruleId: "frame-ancestors-wildcard",
          severity: "low",
          category: "insecure-configuration",
          location: rel,
          line: lineAt(text, text.search(/frame-ancestors\s+\*/)),
          evidence: "frame-ancestors * allows any site to embed this response",
          suggestedFix: "Restrict frame-ancestors to known partner origins if the embed should not be universal.",
        }),
      );
    }
  }

  if (adminRoutes > 0 && adminGuarded === adminRoutes) {
    passed.push({
      id: "admin-routes",
      summary: `All ${adminRoutes} admin API routes except the login session route call requireAdminApiRequest.`,
    });
  }

  findings.sort((a, b) => a.location.localeCompare(b.location) || (a.line ?? 0) - (b.line ?? 0) || a.ruleId.localeCompare(b.ruleId));
  return { findings, passed, filesScanned: files.length };
}

function isCli() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isCli()) {
  const root = process.argv[2] || process.cwd();
  process.stdout.write(`${JSON.stringify(runAppChecks(root), null, 2)}\n`);
}
