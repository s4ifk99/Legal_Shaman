import fs from "node:fs";
import { redact } from "./redact.mjs";

const [name, exitCode, stderrFile, dest] = process.argv.slice(2);
let stderr = "";
if (stderrFile && fs.existsSync(stderrFile)) {
  stderr = fs.readFileSync(stderrFile, "utf8");
}
const tail = redact(stderr).slice(-500);
const payload = {
  name,
  exitCode: Number(exitCode),
  stderrTail: tail || null,
};
fs.writeFileSync(dest, `${JSON.stringify(payload, null, 2)}\n`);
