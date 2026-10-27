import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));

export const repoRoot = path.resolve(scriptsDir, "../../..");

export function reportDir() {
  const dir = process.env.REPORT_DIR;
  if (!dir) throw new Error("REPORT_DIR is not set");
  return dir;
}

export function writeStatus(scanner, status, detail) {
  const dir = reportDir();
  fs.mkdirSync(dir, { recursive: true });
  const body = {
    scanner,
    status,
    detail: String(detail ?? "").slice(0, 800),
  };
  fs.writeFileSync(path.join(dir, `${scanner}.status.json`), `${JSON.stringify(body, null, 2)}\n`);
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function tryReadJson(file) {
  try {
    return readJson(file);
  } catch {
    return null;
  }
}

export function isHighOrCritical(severity) {
  return severity === "high" || severity === "critical";
}

export function semgrepSeverity(value) {
  const text = String(value ?? "").trim().toUpperCase();
  if (text === "CRITICAL" || text === "ERROR") return text === "CRITICAL" ? "critical" : "high";
  if (text === "WARNING") return "medium";
  if (text === "INFO" || text === "INVENTORY") return "low";
  return "unspecified";
}
