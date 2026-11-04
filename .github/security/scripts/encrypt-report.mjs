import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const FILES = [
  "security-report.json",
  "security-report.md",
  "npm-audit.json",
  "osv.json",
  "gitleaks.json",
  "semgrep.json",
  "zap.json",
  "zap.html",
  "app-checks.json",
];

function writeOutput(key, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

export function encryptBytes(plaintext, passphrase) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32, { N: 16384, r: 8, p: 1 });
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from("LSSRGCM1\n"), salt, iv, tag, ciphertext]);
}

export function decryptBytes(payload, passphrase) {
  const magic = Buffer.from("LSSRGCM1\n");
  if (!payload.subarray(0, magic.length).equals(magic)) {
    throw new Error("Report file is not an encrypted Legal Shaman security report");
  }
  let offset = magic.length;
  const salt = payload.subarray(offset, offset + 16);
  offset += 16;
  const iv = payload.subarray(offset, offset + 12);
  offset += 12;
  const tag = payload.subarray(offset, offset + 16);
  offset += 16;
  const ciphertext = payload.subarray(offset);
  const key = scryptSync(passphrase, salt, 32, { N: 16384, r: 8, p: 1 });
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function pack(outDir) {
  const parts = [];
  for (const name of FILES) {
    const full = path.join(outDir, name);
    if (!fs.existsSync(full)) continue;
    const body = fs.readFileSync(full);
    const header = Buffer.from(`${name}\n${body.length}\n`);
    parts.push(header, body);
  }
  if (!parts.length) throw new Error("No report files to encrypt");
  return Buffer.concat(parts);
}

export function unpack(payload, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  let offset = 0;
  const written = [];
  while (offset < payload.length) {
    const headerEnd = payload.indexOf(0x0a, offset);
    const sizeEnd = payload.indexOf(0x0a, headerEnd + 1);
    if (headerEnd === -1 || sizeEnd === -1) break;
    const name = payload.subarray(offset, headerEnd).toString("utf8");
    const size = Number(payload.subarray(headerEnd + 1, sizeEnd).toString("utf8"));
    if (!FILES.includes(name) || !Number.isInteger(size) || size < 0) {
      throw new Error("Encrypted report contains an unexpected file");
    }
    const start = sizeEnd + 1;
    const body = payload.subarray(start, start + size);
    if (body.length !== size) throw new Error("Encrypted report is truncated");
    const safe = path.join(destDir, name);
    fs.writeFileSync(safe, body);
    written.push(name);
    offset = start + size;
  }
  return written;
}

function reportDate(outDir) {
  const reportPath = path.join(outDir, "security-report.json");
  if (!fs.existsSync(reportPath)) return new Date().toISOString().slice(0, 10);
  try {
    return JSON.parse(fs.readFileSync(reportPath, "utf8")).londonDate || new Date().toISOString().slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function isCli() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isCli()) {
  const outDir = process.env.OUT_DIR || process.argv[2];
  const uploadDir = process.env.UPLOAD_DIR || path.join(path.dirname(outDir), "upload");
  const passphrase = process.env.SECURITY_SCAN_REPORT_KEY || "";
  const date = reportDate(outDir);
  writeOutput("report_date", date);
  if (passphrase.length < 16) {
    writeOutput("encrypted", "false");
    console.error("SECURITY_SCAN_REPORT_KEY is missing or shorter than 16 characters. Refusing to upload a plaintext report.");
    process.exit(1);
  }
  fs.mkdirSync(uploadDir, { recursive: true });
  const encrypted = encryptBytes(pack(outDir), passphrase);
  const dest = path.join(uploadDir, `security-report-${date}.bin`);
  fs.writeFileSync(dest, encrypted);
  writeOutput("encrypted", "true");
  console.log(`Encrypted report written. Bytes=${encrypted.length}. Plaintext was not uploaded.`);
}
