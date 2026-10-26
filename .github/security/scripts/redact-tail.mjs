import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { redactText } from "./redact.mjs";

function main() {
  const [source, dest] = process.argv.slice(2);
  const text = redactText(readFileSync(source, "utf8"));
  writeFileSync(dest, text.slice(-1500));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
