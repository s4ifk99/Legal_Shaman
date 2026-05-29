import "./load-dotenv";
import { printEnvironmentSnapshot, requireOpsEnvironment } from "../lib/ops/environment-guard";
import { runProdHealth } from "../lib/ops/prod-health";

async function main() {
  requireOpsEnvironment(process.argv);
  const report = await runProdHealth();
  printEnvironmentSnapshot(report.environment);
  console.info(JSON.stringify({ event: "prod_health", ...report }, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
