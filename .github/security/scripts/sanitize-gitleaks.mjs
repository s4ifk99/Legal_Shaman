import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { redactText } from "./redact.mjs";

const KEEP = new Set([
  "Commit",
  "File",
  "RuleID",
  "Description",
  "StartLine",
  "EndLine",
  "Entropy",
  "Fingerprint",
  "Link",
  "Date",
  "Author",
  "Email",
  "Message",
  "SymlinkFile",
  "Tags",
]);

export function sanitizeGitleaksDocument(document) {
  const rows = Array.isArray(document) ? document : [];
  return rows.map((row) => {
    const clean = {};
    for (const [key, value] of Object.entries(row)) {
      if (!KEEP.has(key)) continue;
      clean[key] = typeof value === "string" ? redactText(value) : value;
    }
    clean.Secret = "[REDACTED]";
    clean.Match = "[REDACTED]";
    clean.Line = "[REDACTED]";
    return clean;
  });
}

function main() {
  const rawPath = process.argv[2];
  const outPath = process.argv[3];
  if (!rawPath || !outPath) {
    console.error("usage: sanitize-gitleaks.mjs <raw.json> <out.json>");
    process.exit(1);
  }
  let parsed = [];
  if (fs.existsSync(rawPath) && fs.statSync(rawPath).size > 0) {
    try {
      parsed = JSON.parse(fs.readFileSync(rawPath, "utf8"));
    } catch {
      fs.rmSync(rawPath, { force: true });
      console.error("gitleaks report could not be parsed and was deleted");
      process.exit(1);
    }
  }
  const clean = sanitizeGitleaksDocument(parsed);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(clean)}\n`);
  if (fs.existsSync(rawPath)) fs.rmSync(rawPath, { force: true });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
