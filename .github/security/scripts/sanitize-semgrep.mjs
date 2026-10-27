import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { redactText } from "./redact.mjs";

export function sanitizeSemgrepDocument(document) {
  const clone = document && typeof document === "object" ? document : { results: [] };
  for (const result of clone.results || []) {
    const extra = result.extra;
    if (!extra || typeof extra !== "object") continue;
    if (typeof extra.lines === "string") extra.lines = redactText(extra.lines).slice(0, 300);
    if (typeof extra.message === "string") extra.message = redactText(extra.message);
    delete extra.fixed_lines;
    if (extra.metavars && typeof extra.metavars === "object") {
      for (const meta of Object.values(extra.metavars)) {
        if (!meta || typeof meta !== "object") continue;
        if ("abstract_content" in meta) meta.abstract_content = "[REDACTED]";
        if ("propagated_content" in meta) meta.propagated_content = "[REDACTED]";
      }
    }
  }
  return clone;
}

function main() {
  const rawPath = process.argv[2];
  const outPath = process.argv[3];
  if (!rawPath || !outPath) {
    console.error("usage: sanitize-semgrep.mjs <raw.json> <out.json>");
    process.exit(1);
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(rawPath, "utf8"));
  } catch {
    fs.rmSync(rawPath, { force: true });
    console.error("semgrep report could not be parsed and was deleted");
    process.exit(1);
  }
  const clean = sanitizeSemgrepDocument(parsed);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(clean)}\n`);
  fs.rmSync(rawPath, { force: true });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
