import { spawnSync } from "child_process";
import path from "path";

const script = path.join(__dirname, "providers-crawl.ts");
const r = spawnSync("tsx", [script, "trustpilot", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
});
process.exit(r.status ?? 1);
