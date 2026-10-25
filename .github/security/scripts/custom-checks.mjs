import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "security-reports"]);

function walk(root, dir = root, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full).split(path.sep).join("/");
    if (rel === "web/data" || rel.startsWith("web/data/")) continue;
    if (entry.isDirectory()) walk(root, full, files);
    else if (entry.isFile()) files.push(rel);
  }
  return files;
}

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

function callArgument(text, start) {
  let i = start;
  while (i < text.length && text[i] !== "(" && text[i] !== "\n") i += 1;
  if (text[i] !== "(") return null;
  let depth = 0;
  let quote = "";
  const argStart = i + 1;
  for (let k = i; k < text.length; k += 1) {
    const ch = text[k];
    if (quote) {
      if (ch === "\\") {
        k += 1;
        continue;
      }
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return text.slice(argStart, k);
    }
  }
  return null;
}

function isSqlLiteral(argument) {
  const body = argument.trim();
  if (!body) return false;
  if (body.startsWith("`") && body.endsWith("`")) return !body.includes("${");
  if ((body.startsWith('"') && body.endsWith('"')) || (body.startsWith("'") && body.endsWith("'"))) {
    return !body.includes("${");
  }
  return false;
}

function add(findings, finding) {
  findings.push(finding);
}

export function runCustomChecks(root) {
  const findings = [];
  const limitations = [
    "Project checks read the current tree only. They do not execute the application and they do not send source to an external service.",
  ];
  const files = walk(root);

  for (const file of files) {
    const rel = file;
    if (rel.startsWith(".github/security/")) continue;
    if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(rel)) continue;
    const text = fs.readFileSync(path.join(root, rel), "utf8");

    if (rel.startsWith("web/app/api/admin/") && rel.endsWith("/route.ts")) {
      if (rel === "web/app/api/admin/session/route.ts") {
        if (/json\(\s*\{[^}]*\bsecret\s*:/.test(text)) {
          add(findings, {
            severity: "critical",
            category: "authorisation",
            rule: "legalshaman.auth.admin-session-returns-secret",
            location: `${rel}:1`,
            evidence: "Admin session response includes a secret field.",
            suggestion: "Return only a boolean or a session cookie. Never return ADMIN_SECRET or the session token in JSON.",
          });
        }
      } else if (!text.includes("requireAdminApiRequest")) {
        add(findings, {
          severity: "high",
          category: "authorisation",
          rule: "legalshaman.auth.admin-route-missing-gate",
          location: `${rel}:1`,
          evidence: "Admin route handler does not reference requireAdminApiRequest.",
          suggestion: "Call requireAdminApiRequest at the start of every admin handler and return its denial response.",
        });
      }
    }

    if (rel.startsWith("web/app/api/internal/") && rel.endsWith("/route.ts")) {
      if (!text.includes("verifyInternalCoherenceRequest")) {
        add(findings, {
          severity: "high",
          category: "authentication",
          rule: "legalshaman.auth.internal-route-missing-gate",
          location: `${rel}:1`,
          evidence: "Internal route does not reference verifyInternalCoherenceRequest.",
          suggestion: "Require the internal shared-secret check before any internal handler does work.",
        });
      }
    }

    for (const needle of ["$queryRawUnsafe", "$executeRawUnsafe"]) {
      let cursor = 0;
      while (cursor < text.length) {
        const unsafe = text.indexOf(needle, cursor);
        if (unsafe === -1) break;
        const argument = callArgument(text, unsafe + needle.length);
        const line = lineOf(text, unsafe);
        const body = argument ?? "";
        const literal = isSqlLiteral(body);
        if (!literal) {
          add(findings, {
            severity: "high",
            category: "injection",
            rule: "legalshaman.injection.raw-sql-interpolation",
            location: `${rel}:${line}`,
            evidence: "Unsafe raw SQL is called with interpolation or a non-literal statement.",
            suggestion: "Use a parameterised Prisma query. Pass limits and identifiers as bound values, not as interpolated SQL.",
          });
        } else {
          add(findings, {
            severity: "low",
            category: "injection",
            rule: "legalshaman.injection.raw-sql-constant",
            location: `${rel}:${line}`,
            evidence: "Unsafe raw SQL is used with a constant statement.",
            suggestion: "Prefer the tagged prisma.$queryRaw template so a later edit cannot silently concatenate input.",
          });
        }
        cursor = unsafe + needle.length;
      }
    }

    if (/rawQuery:\s*args\.query/.test(text)) {
      const index = text.search(/rawQuery:\s*args\.query/);
      add(findings, {
        severity: "high",
        category: "sensitive-data",
        rule: "legalshaman.sensitive-data.raw-query-persisted",
        location: `${rel}:${lineOf(text, index)}`,
        evidence: "A search query is stored in rawQuery. Legal questions can contain personal data.",
        suggestion: "Store a hash or a coarse category instead of the raw question. The existing TODO in the search logger calls for this minimisation.",
      });
    }

    const htmlIndex = text.search(/dangerouslySetInnerHTML[\s\S]{0,240}\$\{/);
    if (htmlIndex !== -1) {
      add(findings, {
        severity: "medium",
        category: "xss",
        rule: "legalshaman.xss.interpolated-html",
        location: `${rel}:${lineOf(text, htmlIndex)}`,
        evidence: "dangerouslySetInnerHTML includes an interpolated value.",
        suggestion: "Render text through React. Sanitise HTML and allowlist any value that is interpolated into it.",
      });
    }
  }

  const ahrefs = "web/components/analytics/ahrefs-analytics.tsx";
  const ahrefsPath = path.join(root, ahrefs);
  if (fs.existsSync(ahrefsPath) && fs.readFileSync(ahrefsPath, "utf8").includes("data-key=")) {
    add(findings, {
      severity: "low",
      category: "secrets",
      rule: "legalshaman.secrets.public-analytics-key",
      location: `${ahrefs}:9`,
      evidence: "A browser analytics data-key is hardcoded in a client component. The value is not copied into this report.",
      suggestion: "Move the publishable analytics key to an environment variable and confirm it cannot read account data.",
    });
  }

  const nextConfig = path.join(root, "web/next.config.mjs");
  if (fs.existsSync(nextConfig) && fs.readFileSync(nextConfig, "utf8").includes("ignoreBuildErrors: true")) {
    add(findings, {
      severity: "low",
      category: "insecure-config",
      rule: "legalshaman.config.typescript-errors-ignored",
      location: "web/next.config.mjs",
      evidence: "typescript.ignoreBuildErrors is enabled, so type errors do not fail the production build.",
      suggestion: "Turn ignoreBuildErrors off once existing type errors are cleared so security-relevant mistakes fail the build.",
    });
  }

  try {
    const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" });
    for (const rel of tracked.split("\n")) {
      if (!rel) continue;
      if (rel.includes("node_modules/") || rel.includes(".next/")) {
        add(findings, {
          severity: "high",
          category: "secrets",
          rule: "legalshaman.secrets.tracked-build-output",
          location: rel,
          evidence: "Build or dependency output is tracked. Those trees can contain generated keys.",
          suggestion: "Remove the path from git history going forward and keep it ignored. This scan does not rewrite history.",
        });
      }
    }
  } catch (error) {
    limitations.push(`Could not list tracked files: ${error.message}`);
  }

  const pinned = new Set();
  const reqFile = path.join(root, "scripts/exa/requirements-exa.txt");
  if (fs.existsSync(reqFile)) {
    for (const line of fs.readFileSync(reqFile, "utf8").split("\n")) {
      const name = line.split("==")[0].trim().toLowerCase();
      if (name) pinned.add(name);
    }
  }
  const thirdParty = ["pandas", "requests", "numpy", "sentence_transformers", "torch"];
  for (const rel of files.filter((item) => item.endsWith(".py"))) {
    const text = fs.readFileSync(path.join(root, rel), "utf8");
    for (const name of thirdParty) {
      const importRe = new RegExp(`^\\s*(?:import|from)\\s+${name}\\b`, "m");
      if (importRe.test(text) && !pinned.has(name)) {
        add(findings, {
          severity: "info",
          category: "dependencies",
          rule: "legalshaman.deps.unpinned-python-import",
          location: rel,
          evidence: `${name} is imported and is not pinned in a requirements or lock file.`,
          suggestion: "Pin the package in a lockfile so the dependency scan can check a real version. This scan does not guess versions.",
        });
      }
    }
  }

  return { findings, limitations };
}

function main() {
  const root = process.argv[2] || process.cwd();
  const out = process.argv[3];
  const report = runCustomChecks(root);
  const json = JSON.stringify(report, null, 2);
  if (out) fs.writeFileSync(out, json);
  else process.stdout.write(json);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
