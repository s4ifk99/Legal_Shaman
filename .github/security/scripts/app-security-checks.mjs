import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(here, "../../..");
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "data", "reports", "coverage", "dist", "out"]);
const SOURCE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

function walk(dir, files = []) {
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    let info;
    try {
      info = statSync(full);
    } catch {
      continue;
    }
    if (info.isDirectory()) walk(full, files);
    else if (SOURCE_EXT.has(path.extname(entry))) files.push(full);
  }
  return files;
}

function rel(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function lineOf(text, index) {
  return text.slice(0, index).split(/\n/).length;
}

function finding(fields) {
  return {
    scanner: "app-security-checks",
    url: null,
    ...fields,
  };
}

function read(file) {
  return readFileSync(file, "utf8");
}

function extractCall(source, start) {
  const open = source.indexOf("(", start);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const char = source[i];
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
}

function importedFromApp(root, file) {
  const base = path.basename(file, path.extname(file));
  const appDir = path.join(root, "web/app");
  const files = walk(appDir);
  return files.some((candidate) => read(candidate).includes(base));
}

export function runAppChecks(root) {
  const findings = [];
  const coverageNotes = [
    "Application checks read TypeScript and JavaScript under web/app, web/lib, web/components, web/scripts, scripts, and static-site. Generated catalogues in web/data are not treated as application code.",
  ];

  const middlewarePath = path.join(root, "web/middleware.ts");
  let middleware = "";
  try {
    middleware = read(middlewarePath);
  } catch {
    findings.push(finding({
      ruleId: "auth.middleware-admin-gate",
      severity: "critical",
      title: "Admin middleware is missing",
      location: "web/middleware.ts",
      line: 1,
      evidence: "web/middleware.ts is not present, so /admin and /api/admin have no shared gate.",
      remediation: "Restore middleware that rejects unauthenticated /api/admin requests with 401 and redirects other /admin pages to login.",
    }));
  }
  if (middleware && (!middleware.includes("/api/admin") || !middleware.includes("/admin") || !middleware.includes("401"))) {
    findings.push(finding({
      ruleId: "auth.middleware-admin-gate",
      severity: "critical",
      title: "Admin routes are not gated in middleware",
      location: "web/middleware.ts",
      line: 1,
      evidence: "middleware.ts no longer shows both the /admin and /api/admin checks and a 401 response.",
      remediation: "Keep the production admin gate in middleware: require the admin session or x-admin-secret, and return 401 for /api/admin.",
    }));
  }

  const guarded = [
    ["web/app/api/lawyers/embed/route.ts", "ADMIN_TOKEN", "auth.lawyers-embed", "Lawyer embed route must require ADMIN_TOKEN"],
    ["web/app/api/billing/stripe-webhook/route.ts", "constructEvent", "auth.stripe-webhook", "Stripe webhook must verify the signature"],
    ["web/app/api/billing/revenuecat-webhook/route.ts", "REVENUECAT_WEBHOOK_SECRET", "auth.revenuecat-webhook", "RevenueCat webhook must require its shared secret"],
  ];
  for (const [relative, marker, ruleId, title] of guarded) {
    const file = path.join(root, relative);
    let source = "";
    try {
      source = read(file);
    } catch {
      source = "";
    }
    if (!source.includes(marker)) {
      findings.push(finding({
        ruleId,
        severity: "critical",
        title,
        location: relative,
        line: 1,
        evidence: source ? `The file does not reference ${marker}.` : "The route file is missing.",
        remediation: `Restore the server-side check (${marker}) before this route performs work. Do not accept browser-supplied identity alone.`,
      }));
    }
  }

  const internalDir = path.join(root, "web/app/api/internal");
  for (const file of walk(internalDir)) {
    if (!file.endsWith(`${path.sep}route.ts`) && !file.endsWith("/route.ts")) continue;
    const source = read(file);
    if (!source.includes("verifyInternalCoherenceRequest")) {
      findings.push(finding({
        ruleId: "auth.internal-route",
        severity: "critical",
        title: "Internal route does not verify the shared secret",
        location: rel(root, file),
        line: 1,
        evidence: "This route under web/app/api/internal does not call verifyInternalCoherenceRequest.",
        remediation: "Call verifyInternalCoherenceRequest before reading a body or forwarding the request.",
      }));
    }
  }

  const accountAllow = new Set([
    "web/app/api/auth/login/route.ts",
    "web/app/api/auth/register/route.ts",
  ]);
  for (const file of walk(path.join(root, "web/app/api"))) {
    if (!file.endsWith("route.ts")) continue;
    const relative = rel(root, file);
    const source = read(file);
    if (!source.includes("accountsPrisma")) continue;
    if (accountAllow.has(relative)) continue;
    if (!source.includes("getCurrentUser") && !source.includes("requireAdminApiRequest")) {
      findings.push(finding({
        ruleId: "auth.accounts-route",
        severity: "high",
        title: "Account data route has no session check",
        location: relative,
        line: lineOf(source, source.indexOf("accountsPrisma")),
        evidence: "This route uses accountsPrisma and does not reference getCurrentUser or requireAdminApiRequest.",
        remediation: "Require a signed-in user or an admin request before reading or writing account rows. Keep login and registration on the explicit public allowlist.",
      }));
    }
  }

  const timingFiles = [
    "web/lib/auth/user-session.ts",
    "web/app/api/admin/session/route.ts",
    "web/app/api/lawyers/embed/route.ts",
    "web/app/api/billing/revenuecat-webhook/route.ts",
  ];
  for (const relative of timingFiles) {
    const file = path.join(root, relative);
    let source = "";
    try {
      source = read(file);
    } catch {
      continue;
    }
    const match = source.match(/!==/);
    if (!match || source.includes("timingSafeEqual")) continue;
    const sensitive = /(secret|password|expected|authorization|mac)/i.test(source);
    if (!sensitive) continue;
    findings.push(finding({
      ruleId: "auth.timing-unsafe-compare",
      severity: "medium",
      title: "Secret compare does not use a constant-time check",
      location: relative,
      line: lineOf(source, match.index),
      evidence: "A secret, password, or MAC is compared with !== and the file does not call timingSafeEqual.",
      remediation: "Hash both values with SHA-256 and compare the digests with crypto.timingSafeEqual so the compare does not leak the secret through timing.",
    }));
  }

  const configPath = path.join(root, "web/next.config.mjs");
  try {
    const source = read(configPath);
    if (/ignoreBuildErrors\s*:\s*true/.test(source)) {
      findings.push(finding({
        ruleId: "config.typescript-ignore-build-errors",
        severity: "medium",
        title: "Production builds ignore TypeScript errors",
        location: "web/next.config.mjs",
        line: lineOf(source, source.search(/ignoreBuildErrors/)),
        evidence: "typescript.ignoreBuildErrors is true.",
        remediation: "Turn ignoreBuildErrors off once the current type errors are fixed so a broken auth or validation change fails the build.",
      }));
    }
    if (!source.includes("headers(") && !source.includes("Content-Security-Policy")) {
      findings.push(finding({
        ruleId: "config.missing-security-headers",
        severity: "medium",
        title: "Next.js config does not set security headers",
        location: "web/next.config.mjs",
        line: 1,
        evidence: "next.config.mjs does not define headers() or a Content-Security-Policy. The live response may still be set by Vercel, which the ZAP baseline checks.",
        remediation: "Add headers for Strict-Transport-Security, X-Content-Type-Options, Referrer-Policy, a restrictive frame policy, and a Content-Security-Policy.",
      }));
    }
  } catch {
    findings.push(finding({
      ruleId: "config.missing-security-headers",
      severity: "medium",
      title: "Next.js config is missing",
      location: "web/next.config.mjs",
      line: 1,
      evidence: "web/next.config.mjs could not be read.",
      remediation: "Restore the Next.js config and set security headers there.",
    }));
  }

  if (middleware.includes("frame-ancestors *")) {
    findings.push(finding({
      ruleId: "config.embed-frame-ancestors-wildcard",
      severity: "info",
      title: "Embed route allows any parent frame",
      location: "web/middleware.ts",
      line: lineOf(middleware, middleware.indexOf("frame-ancestors *")),
      evidence: "Content-Security-Policy frame-ancestors * is set for /embed/signpost.",
      remediation: "Keep the wildcard only on the intentional embed path. Other routes should deny framing or name the parent sites.",
    }));
  }

  const roots = ["web/app", "web/lib", "web/components", "web/scripts", "scripts", "static-site"]
    .map((item) => path.join(root, item));
  const files = roots.flatMap((dir) => walk(dir));
  const secretName = /NEXT_PUBLIC_[A-Z0-9_]*(SECRET|PASSWORD|PRIVATE_KEY|SERVICE_ROLE|DATABASE_URL|SESSION_SECRET)\b/;
  const privateMaterial = [
    { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, title: "Private key material in source" },
    { re: /\bAKIA[0-9A-Z]{16}\b/, title: "AWS access key id in source" },
    { re: /\bsk_live_[0-9A-Za-z]{10,}\b/, title: "Live Stripe secret in source" },
    { re: /\bghp_[A-Za-z0-9]{20,}\b/, title: "GitHub token in source" },
  ];

  for (const file of files) {
    const source = read(file);
    const relative = rel(root, file);
    const secretMatch = source.match(secretName);
    if (secretMatch) {
      findings.push(finding({
        ruleId: "exposure.next-public-secret-name",
        severity: "high",
        title: "Browser-exposed env name looks like a server secret",
        location: relative,
        line: lineOf(source, secretMatch.index),
        evidence: `Found ${secretMatch[0]}. NEXT_PUBLIC_ values are compiled into the client bundle.`,
        remediation: "Remove the NEXT_PUBLIC_ prefix and read the value only on the server.",
      }));
    }
    for (const material of privateMaterial) {
      const match = source.match(material.re);
      if (!match) continue;
      findings.push(finding({
        ruleId: "exposure.private-key-material",
        severity: "critical",
        title: material.title,
        location: relative,
        line: lineOf(source, match.index),
        evidence: "[redacted] A high-confidence credential pattern matched. The value was not copied into this report.",
        remediation: "Remove the credential from the repository and its history, rotate it, and load it from a server-side secret store.",
      }));
    }

    let cursor = 0;
    while (cursor < source.length) {
      const index = source.indexOf("$queryRawUnsafe", cursor);
      if (index < 0) break;
      const args = extractCall(source, index);
      cursor = index + "$queryRawUnsafe".length;
      if (!args || (!args.includes("${") && !args.includes("+"))) continue;
      const inApp = relative.startsWith("web/app/");
      const reachable = inApp || importedFromApp(root, file);
      findings.push(finding({
        ruleId: "injection.query-raw-unsafe",
        severity: reachable ? "high" : "medium",
        title: "SQL is built with $queryRawUnsafe interpolation",
        location: relative,
        line: lineOf(source, index),
        evidence: "The $queryRawUnsafe argument interpolates or concatenates a value. Prisma will not parameterize that string.",
        remediation: reachable
          ? "This module is in a request path or is imported from web/app. Bind values with a tagged prisma.$queryRaw template. Do not insert request data into the SQL string."
          : "Bind values with a tagged prisma.$queryRaw template. If this stays in a maintenance script, coerce any limit to an integer in a fixed range before interpolation.",
      }));
    }

    let htmlCursor = 0;
    while (htmlCursor < source.length) {
      const index = source.indexOf("dangerouslySetInnerHTML", htmlCursor);
      if (index < 0) break;
      htmlCursor = index + "dangerouslySetInnerHTML".length;
      const window = source.slice(index, index + 500);
      const dynamic = window.includes("${") || /__html:\s*[A-Za-z_]/.test(window);
      findings.push(finding({
        ruleId: "xss.dangerously-set-inner-html",
        severity: dynamic ? "medium" : "low",
        title: dynamic ? "dangerouslySetInnerHTML uses dynamic HTML" : "dangerouslySetInnerHTML uses a static snippet",
        location: relative,
        line: lineOf(source, index),
        evidence: dynamic
          ? "The HTML string is built from variables or template interpolation."
          : "The HTML string is a literal. It still bypasses React escaping.",
        remediation: "Prefer React elements. If a vendor snippet must stay, keep it a static literal and do not insert user or catalogue text into it.",
      }));
    }

    if (/rawQuery:\s*args\.query/.test(source)) {
      const index = source.search(/rawQuery:\s*args\.query/);
      findings.push(finding({
        ruleId: "data.search-query-stored",
        severity: "medium",
        title: "Search text is stored without hashing",
        location: relative,
        line: lineOf(source, index),
        evidence: "rawQuery is assigned from the user query. Queries can contain names and personal circumstances.",
        remediation: "Store a hash or a short redacted prefix instead of the full query, and limit who can read the admin review tools.",
      }));
    }
  }

  return {
    scanner: "app-security-checks",
    status: "completed",
    coverageNotes,
    findings,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.argv[2] || defaultRoot;
  const out = process.argv[3];
  const report = runAppChecks(root);
  const body = JSON.stringify(report, null, 2);
  if (out) writeFileSync(out, body);
  else process.stdout.write(`${body}\n`);
}
