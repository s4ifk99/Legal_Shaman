import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function isCli() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isCli()) {
  const reportPath = process.argv[2] || path.join(process.env.OUT_DIR || "out", "security-report.json");
  if (!fs.existsSync(reportPath)) {
    console.log("SECURITY_SCAN_CONCLUSION=incomplete");
    console.log("The security report was not written. This is not a clean result.");
    process.exit(1);
  }
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  const encryption = process.env.ENCRYPTION_STATUS;
  const encryptionFailed = encryption != null && encryption !== "" && encryption !== "true";
  if (encryptionFailed) {
    console.log("SECURITY_SCAN_CONCLUSION=incomplete");
    console.log(`Report conclusion was ${report.conclusion}. The encrypted artifact was not uploaded. This is not a clean result.`);
    console.log(report.conclusionReason);
    process.exit(1);
  }
  console.log(`SECURITY_SCAN_CONCLUSION=${report.conclusion}`);
  console.log(report.conclusionReason);
  if (report.conclusion !== "clean") process.exit(1);
}
