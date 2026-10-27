import { pathToFileURL } from "node:url";
import { writeStatus } from "./lib.mjs";

const scanner = process.argv[2];
const status = process.argv[3];
const detail = process.argv.slice(4).join(" ").trim();
if (!scanner || !status || !detail) {
  console.error("usage: write-status.mjs <scanner> <completed|failed> <detail>");
  process.exit(1);
}
writeStatus(scanner, status, detail);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // invoked as a script
}
