import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { repoRoot, writeStatus } from "./lib.mjs";
import { redactText } from "./redact.mjs";

const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "data",
  "security-reports",
  "coverage",
  "dist",
  "build",
]);

const PY_STDLIB = new Set([
  "__future__", "argparse", "base64", "collections", "csv", "dataclasses", "datetime",
  "functools", "hashlib", "html", "http", "io", "itertools", "json", "math", "os",
  "pathlib", "re", "sys", "time", "typing", "urllib", "uuid", "struct", "textwrap",
]);

const LOCKFILES = [
  "requirements.txt",
  "requirements-dev.txt",
  "requirements.lock",
  "poetry.lock",
  "Pipfile.lock",
  "uv.lock",
  "pdm.lock",
  "pylock.toml",
];

function walk(dir, acc) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (/\.(ts|tsx|js|mjs|cjs|py)$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

function lineNumber(text, needle) {
  const index = text.indexOf(needle);
  if (index < 0) return 1;
  return text.slice(0, index).split("\n").length;
}

function rel(file) {
  return path.relative(repoRoot, file).split(path.sep).join("/");
}

function finding(partial) {
  return {
    scanner: "application-checks",
    evidence: redactText(partial.evidence).slice(0, 400),
    suggestedFix: redactText(partial.suggestedFix).slice(0, 400),
    ...partial,
    evidence: redactText(partial.evidence).slice(0, 400),
    suggestedFix: redactText(partial.suggestedFix).slice(0, 400),
  };
}

function statementFrom(text, index) {
  const slice = text.slice(index, index + 700);
  const end = slice.indexOf(";");
  return end === -1 ? slice : slice.slice(0, end);
}

function sqlSeverity(file, statement) {
  if (!statement.includes("${")) return "low";
  if (/req\.|request\.|searchParams|body\.|params\.|userInput/.test(statement)) return "high";
  return "medium";
}

function collectTiming(findings) {
  const rules = [
    ["web/lib/admin/auth.ts", /header === secret/, "Admin secret is compared with ==="],
    ["web/middleware.ts", /header === secret/, "Admin secret is compared with === in middleware"],
    ["web/app/api/admin/session/route.ts", /password !== secret/, "Admin password is compared with !=="],
    ["web/app/api/lawyers/embed/route.ts", /provided !== expected/, "Embed bearer token is compared with !=="],
    ["web/app/api/billing/revenuecat-webhook/route.ts", /authorization !== `Bearer \$\{secret\}`/, "RevenueCat bearer token is compared with !=="],
    ["web/lib/coherence/server/internal-auth.ts", /got !== expected/, "Internal secret is compared with !=="],
    ["web/lib/auth/user-session.ts", /mac !== expected/, "Session MAC is compared with !=="],
  ];
  for (const [file, pattern, title] of rules) {
    const full = path.join(repoRoot, file);
    if (!fs.existsSync(full)) continue;
    const text = fs.readFileSync(full, "utf8");
    const match = text.match(pattern);
    if (!match) continue;
    findings.push(finding({
      severity: "medium",
      category: "authentication",
      title,
      location: { file, line: lineNumber(text, match[0]) },
      evidence: "Secret material is compared with a normal equality operator.",
      suggestedFix: "Compare equal length digests with crypto.timingSafeEqual. Do not compare the raw secret with === or !==.",
    }));
  }
}

function collectAuthGuards(findings, gaps) {
  const adminRoot = path.join(repoRoot, "web/app/api/admin");
  if (fs.existsSync(adminRoot)) {
    for (const file of walk(adminRoot, [])) {
      if (!file.endsWith(`${path.sep}route.ts`) && !file.endsWith(`${path.sep}route.js`)) continue;
      const relative = rel(file);
      if (relative === "web/app/api/admin/session/route.ts") continue;
      const text = fs.readFileSync(file, "utf8");
      if (!text.includes("requireAdminApiRequest")) {
        findings.push(finding({
          severity: "high",
          category: "authorisation",
          title: "Admin route does not call requireAdminApiRequest",
          location: { file: relative, line: 1 },
          evidence: "This file is under web/app/api/admin and does not reference requireAdminApiRequest.",
          suggestedFix: "Call requireAdminApiRequest at the start of each handler and return the denial response. Keep the middleware gate as well.",
        }));
      }
    }
  }
  gaps.push({
    item: "Admin login route",
    detail: "web/app/api/admin/session/route.ts is the login endpoint. It is not required to call requireAdminApiRequest. Middleware allows that path before a session exists.",
  });

  const internalRoot = path.join(repoRoot, "web/app/api/internal");
  if (fs.existsSync(internalRoot)) {
    for (const file of walk(internalRoot, [])) {
      if (!file.endsWith("route.ts")) continue;
      const text = fs.readFileSync(file, "utf8");
      const relative = rel(file);
      if (!text.includes("verifyInternalCoherenceRequest")) {
        findings.push(finding({
          severity: "high",
          category: "authorisation",
          title: "Internal route does not verify the internal secret",
          location: { file: relative, line: 1 },
          evidence: "This file is under web/app/api/internal and does not reference verifyInternalCoherenceRequest.",
          suggestedFix: "Reject the request unless verifyInternalCoherenceRequest succeeds.",
        }));
      }
    }
  }

  const requiredSnippets = [
    ["web/app/api/billing/checkout/route.ts", "getCurrentUser", "Billing checkout does not load the signed in user"],
    ["web/app/api/bookmarks/route.ts", "getCurrentUser", "Bookmarks route does not load the signed in user"],
    ["web/app/api/billing/stripe-webhook/route.ts", "constructEvent", "Stripe webhook does not verify the signature"],
    ["web/app/api/billing/revenuecat-webhook/route.ts", "REVENUECAT_WEBHOOK_SECRET", "RevenueCat webhook does not read its shared secret"],
    ["web/app/api/lawyers/embed/route.ts", "ADMIN_TOKEN", "Lawyer embed route does not check ADMIN_TOKEN"],
  ];
  for (const [file, snippet, title] of requiredSnippets) {
    const full = path.join(repoRoot, file);
    if (!fs.existsSync(full)) {
      gaps.push({ item: file, detail: "Expected route is missing, so its authentication check did not run." });
      continue;
    }
    const text = fs.readFileSync(full, "utf8");
    if (!text.includes(snippet)) {
      findings.push(finding({
        severity: "high",
        category: "authorisation",
        title,
        location: { file, line: 1 },
        evidence: `Expected to find ${snippet} in this route.`,
        suggestedFix: "Restore the authentication or signature check before any state change.",
      }));
    }
  }
}

function collectInjectionAndXss(findings) {
  const files = walk(repoRoot, []);
  for (const file of files) {
    const stat = fs.statSync(file);
    if (stat.size > 1_000_000) continue;
    const text = fs.readFileSync(file, "utf8");
    const relative = rel(file);

    if (file.endsWith(".py") || relative.startsWith(".github/")) continue;

    const raw = /\$queryRawUnsafe|\$executeRawUnsafe/g;
    let match;
    while ((match = raw.exec(text))) {
      const statement = statementFrom(text, match.index);
      const severity = sqlSeverity(relative, statement);
      findings.push(finding({
        severity,
        category: "injection",
        title: statement.includes("${")
          ? "Raw SQL is built with string interpolation"
          : "Unsafe raw SQL API used for a static query",
        location: { file: relative, line: lineNumber(text, match[0]) },
        evidence: severity === "high"
          ? "The raw SQL call interpolates a value that looks request derived."
          : "The call uses $queryRawUnsafe or $executeRawUnsafe.",
        suggestedFix: "Use a Prisma.sql tagged template or bound parameters. Allowlist any identifier that cannot be bound.",
      }));
    }

    if (text.includes("dangerouslySetInnerHTML")) {
      const line = lineNumber(text, "dangerouslySetInnerHTML");
      const window = text.split("\n").slice(Math.max(0, line - 1), line + 15).join("\n");
      const dynamic = window.includes("${");
      findings.push(finding({
        severity: dynamic ? "medium" : "low",
        category: "xss",
        title: dynamic
          ? "dangerouslySetInnerHTML interpolates values"
          : "dangerouslySetInnerHTML renders a static string",
        location: { file: relative, line },
        evidence: dynamic
          ? "The raw HTML block near this call interpolates values."
          : "The raw HTML block looks static.",
        suggestedFix: dynamic
          ? "Escape or allowlist every interpolated value before it reaches HTML or CSS. Prefer React text nodes."
          : "Keep this markup static. If any part becomes user input, stop using raw HTML.",
      }));
    }

    const evalMatch = text.match(/(?:^|[^\w.$])eval\(/);
    if (evalMatch && typeof evalMatch.index === "number") {
      findings.push(finding({
        severity: "high",
        category: "injection",
        title: "eval is used",
        location: { file: relative, line: text.slice(0, evalMatch.index).split("\n").length },
        evidence: "A call to eval( was found.",
        suggestedFix: "Remove eval. Use a parser or a static import map.",
      }));
    }

    if (text.includes("new Function")) {
      findings.push(finding({
        severity: "medium",
        category: "injection",
        title: "new Function builds code at runtime",
        location: { file: relative, line: lineNumber(text, "new Function") },
        evidence: "new Function was found.",
        suggestedFix: "Replace the dynamic import shim with a static import map.",
      }));
    }
  }
}

function collectSensitiveLogs(findings) {
  const file = "web/lib/auth/password-reset.ts";
  const full = path.join(repoRoot, file);
  if (!fs.existsSync(full)) return;
  const text = fs.readFileSync(full, "utf8");
  if (/console\.log\(\s*["'][^"']*reset URL/.test(text)) {
    findings.push(finding({
      severity: "high",
      category: "sensitive-data",
      title: "Password reset link is written to logs",
      location: { file, line: lineNumber(text, "reset URL") },
      evidence: "When email is not configured, the reset URL is passed to console.log. That URL contains the reset token.",
      suggestedFix: "Log that the email provider is unconfigured. Do not log the reset URL or the token.",
    }));
  }

  const webhook = path.join(repoRoot, "web/app/api/billing/stripe-webhook/route.ts");
  if (fs.existsSync(webhook)) {
    const webhookText = fs.readFileSync(webhook, "utf8");
    if (webhookText.includes("error.message")) {
      findings.push(finding({
        severity: "low",
        category: "sensitive-data",
        title: "Stripe webhook returns exception text to the caller",
        location: { file: "web/app/api/billing/stripe-webhook/route.ts", line: lineNumber(webhookText, "error.message") },
        evidence: "The invalid signature response includes the exception message.",
        suggestedFix: "Return a generic invalid_webhook error. Keep the exception in server logs only if it cannot contain the payload.",
      }));
    }
  }
}

function collectConfig(findings) {
  const configFile = "web/next.config.mjs";
  const full = path.join(repoRoot, configFile);
  if (fs.existsSync(full)) {
    const text = fs.readFileSync(full, "utf8");
    const required = [
      "Content-Security-Policy",
      "Strict-Transport-Security",
      "X-Content-Type-Options",
      "Referrer-Policy",
    ];
    const missing = required.filter((header) => !text.includes(header));
    if (missing.length) {
      findings.push(finding({
        severity: "medium",
        category: "configuration",
        title: "Security headers are not set in next.config.mjs",
        location: { file: configFile, line: lineNumber(text, "const nextConfig") },
        evidence: `Missing ${missing.join(", ")}.`,
        suggestedFix: "Add a headers() function with HSTS, nosniff, a Referrer-Policy, and a Content-Security-Policy that fits this Next.js app. Keep the embed route exception in middleware only.",
      }));
    }
    if (text.includes("ignoreBuildErrors: true")) {
      findings.push(finding({
        severity: "low",
        category: "configuration",
        title: "TypeScript build errors are ignored",
        location: { file: configFile, line: lineNumber(text, "ignoreBuildErrors") },
        evidence: "typescript.ignoreBuildErrors is true, so type errors do not fail the production build.",
        suggestedFix: "Turn ignoreBuildErrors off once existing type errors are fixed, so unsafe code cannot ship silently.",
      }));
    }
  }

  const middleware = path.join(repoRoot, "web/middleware.ts");
  if (fs.existsSync(middleware)) {
    const text = fs.readFileSync(middleware, "utf8");
    if (text.includes("frame-ancestors *")) {
      findings.push(finding({
        severity: "low",
        category: "configuration",
        title: "Embed route allows framing from any origin",
        location: { file: "web/middleware.ts", line: lineNumber(text, "frame-ancestors *") },
        evidence: "Content-Security-Policy frame-ancestors * is set for the embed path.",
        suggestedFix: "Keep this exception limited to /embed/signpost. Do not copy it onto signed in or admin pages.",
      }));
    }
  }
}

function collectPublicSecretNames(findings) {
  const files = walk(path.join(repoRoot, "web"), []);
  const pattern = /NEXT_PUBLIC_[A-Z0-9_]*(SECRET|PRIVATE|PASSWORD|TOKEN)[A-Z0-9_]*/g;
  for (const file of files) {
    if (file.includes(`${path.sep}data${path.sep}`)) continue;
    const text = fs.readFileSync(file, "utf8");
    const names = new Set(text.match(pattern) ?? []);
    for (const name of names) {
      findings.push(finding({
        severity: "high",
        category: "secrets",
        title: "Public environment name looks like a server secret",
        location: { file: rel(file), line: lineNumber(text, name) },
        evidence: `${name} is prefixed with NEXT_PUBLIC_, so Next.js exposes it to the browser.`,
        suggestedFix: "Rename it without NEXT_PUBLIC_ and read it only on the server. Rotate the value if it was ever a real secret.",
      }));
    }
  }
}

function collectTrackedEnv(findings, gaps) {
  let output = "";
  try {
    output = execSync("git ls-files -z", { cwd: repoRoot, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  } catch {
    gaps.push({ item: "Tracked env files", detail: "git ls-files failed, so committed env files were not checked." });
    return;
  }
  const allowed = new Set([".env.example", ".env.sample", ".env.template"]);
  for (const file of output.split("\0")) {
    if (!file) continue;
    const base = path.posix.basename(file);
    if (!base.startsWith(".env")) continue;
    if (allowed.has(base)) continue;
    findings.push(finding({
      severity: "high",
      category: "secrets",
      title: "Environment file is tracked by git",
      location: { file, line: 1 },
      evidence: "A .env file other than an example template is tracked. Its contents were not copied into this report.",
      suggestedFix: "Remove the file from git history, rotate every value in it, and keep real values in the host environment or GitHub Actions secrets.",
    }));
  }
}

function collectPythonGap(gaps) {
  const modules = new Map();
  for (const file of walk(repoRoot, [])) {
    if (!file.endsWith(".py")) continue;
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(/^(?:import|from)\s+([A-Za-z0-9_]+)/gm)) {
      const name = match[1];
      if (PY_STDLIB.has(name)) continue;
      if (!modules.has(name)) modules.set(name, rel(file));
    }
  }
  if (modules.size === 0) return;
  const lockFound = LOCKFILES.some((name) => fs.existsSync(path.join(repoRoot, name)));
  if (lockFound) return;
  const listed = [...modules.entries()].map(([name, file]) => `${name} (${file})`).join(", ");
  gaps.push({
    item: "Python dependencies",
    detail: `Third party Python imports have no lockfile, so npm audit and OSV did not assess them: ${listed}. This is not a clean result for those packages.`,
  });
}

export function runApplicationChecks() {
  const findings = [];
  const coverageGaps = [];
  collectTiming(findings);
  collectAuthGuards(findings, coverageGaps);
  collectInjectionAndXss(findings);
  collectSensitiveLogs(findings);
  collectConfig(findings);
  collectPublicSecretNames(findings);
  collectTrackedEnv(findings, coverageGaps);
  collectPythonGap(coverageGaps);
  coverageGaps.push({
    item: "Authentication review scope",
    detail: "These checks cover admin route guards, the internal secret, billing and bookmark session checks, webhook verification, and known secret comparisons. They are not a full authorisation model review of every public API.",
  });
  return { findings, coverageGaps };
}

function main() {
  const result = runApplicationChecks();
  if (process.env.REPORT_DIR) {
    const dir = process.env.REPORT_DIR;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "application-checks.json"), `${JSON.stringify(result, null, 2)}\n`);
    writeStatus(
      "application-checks",
      "completed",
      `Application checks finished with ${result.findings.length} findings and ${result.coverageGaps.length} coverage notes.`,
    );
  } else {
    process.stdout.write(`${JSON.stringify({ findingCount: result.findings.length, gapCount: result.coverageGaps.length })}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
