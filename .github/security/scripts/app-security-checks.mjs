import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const SOURCE_EXT = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".prisma"])
const SKIP_DIRS = new Set(["node_modules", ".next", "data", "out", ".git", "coverage", ".security-scan-out"])

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, acc)
    else if (entry.isFile()) acc.push(full)
  }
  return acc
}

function lineAt(text, index) {
  let line = 1
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1
  }
  return line
}

function relative(root, file) {
  return path.relative(root, file).split(path.sep).join("/")
}

function readText(file) {
  const stat = fs.statSync(file)
  if (stat.size > 1_500_000) return null
  const buffer = fs.readFileSync(file)
  if (buffer.subarray(0, 1024).includes(0)) return null
  return buffer.toString("utf8")
}

function finding(partial) {
  return {
    scanner: "app-checks",
    url: null,
    ...partial,
  }
}

function extractArgs(source, openParen) {
  let depth = 0
  let quote = null
  for (let i = openParen; i < source.length; i += 1) {
    const char = source[i]
    const prev = source[i - 1]
    if (quote) {
      if (char === quote && prev !== "\\") quote = null
      continue
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char
      continue
    }
    if (char === "(") depth += 1
    else if (char === ")") {
      depth -= 1
      if (depth === 0) return source.slice(openParen + 1, i)
    }
  }
  return null
}

function interpolations(value) {
  return [...value.matchAll(/\$\{([^}]*)\}/g)].map((match) => match[1])
}

const REQUESTISH = /\b(req|request|searchParams|headers|body|params|payload|input)\b/

function scanSql(root, file, text, findings) {
  const re = /\$(queryRawUnsafe|executeRawUnsafe)\s*(?:<[^;\n]{0,120}>)?\s*\(/g
  let match
  while ((match = re.exec(text))) {
    const args = extractArgs(text, match.index + match[0].length - 1)
    const expressions = args ? interpolations(args) : []
    const location = relative(root, file)
    const line = lineAt(text, match.index)
    if (!args) {
      findings.push(finding({
        severity: "medium",
        category: "injection",
        title: "Raw SQL call could not be parsed",
        location,
        line,
        evidence: `${match[1]} is used. The argument was not parsed, so the call needs a manual review.`,
        remediation: "Use a Prisma tagged template with bound parameters. This scan does not change the call.",
      }))
      continue
    }
    if (expressions.some((expr) => REQUESTISH.test(expr))) {
      findings.push(finding({
        severity: "high",
        category: "injection",
        title: "Raw SQL interpolates request data",
        location,
        line,
        evidence: `${match[1]} interpolates an expression that refers to request data. The SQL text is not copied here.`,
        remediation: "Bind request values as query parameters. Do not concatenate them into SQL text.",
      }))
    } else if (expressions.length) {
      findings.push(finding({
        severity: "medium",
        category: "injection",
        title: "Raw SQL interpolates a value",
        location,
        line,
        evidence: `${match[1]} builds SQL with ${expressions.length} interpolation(s). The inserted text is not copied here.`,
        remediation: "Keep SQL static or bind values. A local constant is safer as a bound parameter or an allowlisted identifier.",
      }))
    } else {
      findings.push(finding({
        severity: "low",
        category: "injection",
        title: "Static SQL uses an unsafe query API",
        location,
        line,
        evidence: `${match[1]} is called with a static statement. The statement is not copied here.`,
        remediation: "Prefer a tagged Prisma query so a later edit cannot silently start interpolating input.",
      }))
    }
  }
}

function scanHtml(root, file, text, findings) {
  const re = /dangerouslySetInnerHTML\s*=\s*\{\{([\s\S]{0,500}?)\}\}/g
  let match
  while ((match = re.exec(text))) {
    const body = match[1]
    const location = relative(root, file)
    const line = lineAt(text, match.index)
    if (body.includes("${")) {
      findings.push(finding({
        severity: "medium",
        category: "xss",
        title: "HTML injection sink interpolates values",
        location,
        line,
        evidence: "dangerouslySetInnerHTML uses an interpolated __html value. The markup is not copied here.",
        remediation: "Encode interpolated values for the surrounding HTML or CSS context, or render them as text nodes.",
      }))
    } else if (body.includes("</")) {
      findings.push(finding({
        severity: "medium",
        category: "xss",
        title: "Constant HTML breaks out of its element",
        location,
        line,
        evidence: "A constant dangerouslySetInnerHTML value contains a closing tag. The snippet is not copied here.",
        remediation: "Keep vendor snippets in a reviewed constant and avoid closing the surrounding script tag from inside the string.",
      }))
    }
  }
  const inner = /\.innerHTML\s*=\s*([^;\n]+)/g
  while ((match = inner.exec(text))) {
    const rhs = match[1].trim()
    if (/^(['"`])\s*\1$/.test(rhs)) continue
    findings.push(finding({
      severity: "medium",
      category: "xss",
      title: "innerHTML assignment",
      location: relative(root, file),
      line: lineAt(text, match.index),
      evidence: "innerHTML is assigned from an expression. The expression is not copied here.",
      remediation: "Use textContent or a framework render path unless the HTML is a reviewed constant.",
    }))
  }
}

function scanDynamicCode(root, file, text, findings) {
  // Require eval( with no space so prose such as "eval (cases)" is not flagged.
  const re = /\bnew\s+Function\s*\(|\beval\(/g
  let match
  while ((match = re.exec(text))) {
    findings.push(finding({
      severity: "medium",
      category: "injection",
      title: "Dynamic code execution",
      location: relative(root, file),
      line: lineAt(text, match.index),
      evidence: "eval or new Function is present. The argument is not copied here.",
      remediation: "Replace it with a direct function or import. Do not pass request data into executed text.",
    }))
  }
}

function scanClientSecrets(root, file, text, findings) {
  const re = /NEXT_PUBLIC_[A-Z0-9_]*(SECRET|PASSWORD|PRIVATE_KEY|API_KEY)\b/g
  let match
  while ((match = re.exec(text))) {
    findings.push(finding({
      severity: "high",
      category: "secrets",
      title: "Client environment variable is named like a secret",
      location: relative(root, file),
      line: lineAt(text, match.index),
      evidence: `${match[0]} would be embedded in the browser bundle if it is set. The value is not copied here.`,
      remediation: "Rename it to a server-only variable. NEXT_PUBLIC values are visible to every visitor.",
    }))
  }
}

function routeFiles(root, prefix) {
  const dir = path.join(root, prefix)
  return walk(dir).filter((file) => file.endsWith(`${path.sep}route.ts`) || file.endsWith(`${path.sep}route.js`))
}

export function runAppChecks(root) {
  const findings = []
  const roots = ["web", "scripts", "infra", "static-site"].map((name) => path.join(root, name))
  const files = roots.flatMap((dir) => walk(dir))

  for (const file of files) {
    const base = path.basename(file)
    if (base === ".env" || (base.startsWith(".env") && base !== ".env.example")) {
      findings.push(finding({
        severity: "high",
        category: "secrets",
        title: "Secret env file is in the scanned tree",
        location: relative(root, file),
        line: 1,
        evidence: "The file name is a secret env file. Its contents were not read or copied.",
        remediation: "Remove the file from the repository and rotate any credential that was committed.",
      }))
      continue
    }
    const ext = path.extname(file)
    if (!SOURCE_EXT.has(ext) && base !== ".env.example") continue
    const text = readText(file)
    if (text == null) continue
    scanSql(root, file, text, findings)
    scanHtml(root, file, text, findings)
    scanDynamicCode(root, file, text, findings)
    scanClientSecrets(root, file, text, findings)
  }

  const adminRoutes = routeFiles(root, "web/app/api/admin")
  const sessionRel = "web/app/api/admin/session/route.ts"
  if (adminRoutes.length && !fs.existsSync(path.join(root, "web/middleware.ts"))) {
    findings.push(finding({
      severity: "high",
      category: "auth",
      title: "Admin API exists without middleware",
      location: "web/middleware.ts",
      line: null,
      evidence: "web/app/api/admin has route handlers and web/middleware.ts is absent.",
      remediation: "Restore an admin gate that rejects unauthenticated requests to /admin and /api/admin in production.",
    }))
  }
  for (const file of adminRoutes) {
    const rel = relative(root, file)
    const text = readText(file) || ""
    if (rel === sessionRel) {
      if (!/password\s*!==\s*secret/.test(text) && !/timingSafeEqual/.test(text)) {
        findings.push(finding({
          severity: "high",
          category: "auth",
          title: "Admin login does not check the admin secret",
          location: rel,
          line: 1,
          evidence: "The session route does not compare the submitted password with ADMIN_SECRET.",
          remediation: "Reject the login unless the password matches ADMIN_SECRET, then set an httpOnly session cookie.",
        }))
      } else if (!/timingSafeEqual/.test(text)) {
        findings.push(finding({
          severity: "low",
          category: "auth",
          title: "Admin password comparison is not timing-safe",
          location: rel,
          line: lineAt(text, text.search(/password\s*!==\s*secret/)),
          evidence: "The login check uses a direct string comparison.",
          remediation: "Compare digests with crypto.timingSafeEqual so the check does not leak the secret through timing.",
        }))
      }
      continue
    }
    if (!text.includes("requireAdminApiRequest")) {
      findings.push(finding({
        severity: "high",
        category: "auth",
        title: "Admin route does not call the admin authorisation helper",
        location: rel,
        line: 1,
        evidence: "This admin route handler does not reference requireAdminApiRequest.",
        remediation: "Call requireAdminApiRequest at the start of every handler and return its response when access is denied.",
      }))
    }
  }

  for (const file of routeFiles(root, "web/app/api/internal")) {
    const text = readText(file) || ""
    if (!text.includes("verifyInternalCoherenceRequest")) {
      findings.push(finding({
        severity: "high",
        category: "auth",
        title: "Internal route does not verify the internal secret",
        location: relative(root, file),
        line: 1,
        evidence: "The handler does not reference verifyInternalCoherenceRequest.",
        remediation: "Reject the request unless the internal shared secret matches.",
      }))
    }
  }

  const controls = [
    ["web/app/api/billing/stripe-webhook/route.ts", "constructEvent", "Stripe webhook does not verify the signature", "Call stripe.webhooks.constructEvent with the raw body and STRIPE_WEBHOOK_SECRET before trusting the event."],
    ["web/app/api/billing/revenuecat-webhook/route.ts", "REVENUECAT_WEBHOOK_SECRET", "RevenueCat webhook does not check its secret", "Require the configured bearer secret before updating entitlements."],
    ["web/app/api/lawyers/embed/route.ts", "ADMIN_TOKEN", "Embedding route does not check the admin token", "Require Authorization: Bearer ADMIN_TOKEN before regenerating embeddings."],
  ]
  for (const [rel, needle, title, remediation] of controls) {
    const full = path.join(root, rel)
    if (!fs.existsSync(full)) continue
    const text = readText(full) || ""
    if (!text.includes(needle)) {
      findings.push(finding({
        severity: "high",
        category: "auth",
        title,
        location: rel,
        line: 1,
        evidence: `The handler no longer references ${needle}.`,
        remediation,
      }))
    }
  }

  const middlewarePath = path.join(root, "web/middleware.ts")
  if (fs.existsSync(middlewarePath)) {
    const text = readText(middlewarePath) || ""
    if (!text.includes('"/api/admin"') && !text.includes("'/api/admin'") && !text.includes("/api/admin")) {
      findings.push(finding({
        severity: "high",
        category: "auth",
        title: "Middleware does not mention the admin API",
        location: "web/middleware.ts",
        line: 1,
        evidence: "The middleware file has no /api/admin check.",
        remediation: "Keep the production admin gate in middleware as well as in each handler.",
      }))
    }
    const frame = text.indexOf("frame-ancestors *")
    if (frame !== -1) {
      findings.push(finding({
        severity: "low",
        category: "configuration",
        title: "Embed route allows any site to frame it",
        location: "web/middleware.ts",
        line: lineAt(text, frame),
        evidence: "Content-Security-Policy is set to frame-ancestors * for the embed path.",
        remediation: "Limit frame-ancestors to the partner origins that should embed the widget.",
      }))
    }
  }

  const nextConfig = path.join(root, "web/next.config.mjs")
  if (fs.existsSync(nextConfig)) {
    const text = readText(nextConfig) || ""
    if (/ignoreBuildErrors\s*:\s*true/.test(text)) {
      findings.push(finding({
        severity: "medium",
        category: "configuration",
        title: "Production builds ignore TypeScript errors",
        location: "web/next.config.mjs",
        line: lineAt(text, text.search(/ignoreBuildErrors\s*:\s*true/)),
        evidence: "typescript.ignoreBuildErrors is true.",
        remediation: "Turn ignoreBuildErrors off so type errors cannot hide broken security checks.",
      }))
    }
    if (!/headers\s*\(/.test(text)) {
      findings.push(finding({
        severity: "medium",
        category: "configuration",
        title: "Next.js config does not set baseline security headers",
        location: "web/next.config.mjs",
        line: 1,
        evidence: "next.config.mjs has no headers() function.",
        remediation: "Add Strict-Transport-Security, X-Content-Type-Options, Referrer-Policy, and a Content-Security-Policy for the main site. Set poweredByHeader to false. Keep frame-ancestors narrower than * outside the embed route.",
      }))
    }
  }

  const schema = path.join(root, "web/prisma/schema.prisma")
  if (fs.existsSync(schema)) {
    const text = readText(schema) || ""
    const index = text.indexOf("rawQuery")
    if (index !== -1 && text.includes("model SearchInteraction")) {
      findings.push(finding({
        severity: "medium",
        category: "data-exposure",
        title: "Search queries are stored as raw text",
        location: "web/prisma/schema.prisma",
        line: lineAt(text, index),
        evidence: "SearchInteraction.rawQuery stores the search text. The schema comment already notes personal-data minimisation.",
        remediation: "Truncate or hash raw queries, restrict who can read them, and set a retention period. Search text can contain names and case details.",
      }))
    }
  }

  return findings.map((item, index) => ({
    id: `app-${index + 1}`,
    ...item,
  }))
}

function main() {
  const rootFlag = process.argv.indexOf("--root")
  const outFlag = process.argv.indexOf("--out")
  const root = rootFlag === -1 ? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..") : process.argv[rootFlag + 1]
  const findings = runAppChecks(root)
  const payload = JSON.stringify({ findings }, null, 2)
  if (outFlag !== -1) fs.writeFileSync(process.argv[outFlag + 1], payload)
  else process.stdout.write(payload)
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
if (isMain) main()
