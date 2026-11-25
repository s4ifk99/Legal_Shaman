import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function parseArgs(argv) {
  const args = { id: "", status: "failed", detail: "", privateDetail: "", notes: [], out: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--id") args.id = value;
    else if (key === "--status") args.status = value;
    else if (key === "--detail") args.detail = value;
    else if (key === "--private-detail-file") args.privateDetailFile = value;
    else if (key === "--note") args.notes.push(value);
    else if (key === "--out") args.out = value;
    else continue;
    i += 1;
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const privateDetail = args.privateDetailFile ? readFileSync(args.privateDetailFile, "utf8") : "";
  mkdirSync(path.dirname(args.out), { recursive: true });
  writeFileSync(args.out, JSON.stringify({
    id: args.id,
    status: args.status,
    detail: args.detail,
    privateDetail,
    coverageNotes: args.notes,
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
