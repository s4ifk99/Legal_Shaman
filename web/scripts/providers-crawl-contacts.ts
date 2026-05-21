import { spawnSync } from "child_process";
import path from "path";

const script = path.join(__dirname, "providers-crawl.ts");
const args = ["contacts", ...process.argv.slice(2)];
const r = spawnSync("tsx", [script, ...args], { stdio: "inherit", env: process.env });
process.exit(r.status ?? 1);
