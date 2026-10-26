import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { redactGitleaksReport } from "./redact.mjs";

function main() {
  const file = process.argv[2];
  const text = readFileSync(file, "utf8").trim();
  const doc = text ? JSON.parse(text) : [];
  if (!Array.isArray(doc)) {
    throw new Error("gitleaks report was not a JSON array");
  }
  writeFileSync(file, JSON.stringify(redactGitleaksReport(doc)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
