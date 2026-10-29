import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { decryptBytes, unpack } from "./encrypt-report.mjs";

function isCli() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isCli()) {
  const [file, dest] = process.argv.slice(2);
  const passphrase = process.env.SECURITY_SCAN_REPORT_KEY || "";
  if (!file || !dest) {
    console.error("Usage: SECURITY_SCAN_REPORT_KEY=... node decrypt-report.mjs <report.bin> <output-directory>");
    process.exit(1);
  }
  if (passphrase.length < 16) {
    console.error("SECURITY_SCAN_REPORT_KEY must be at least 16 characters.");
    process.exit(1);
  }
  const payload = decryptBytes(fs.readFileSync(file), passphrase);
  const written = unpack(payload, dest);
  console.log(`Decrypted ${written.join(", ")} into ${path.resolve(dest)}`);
}
