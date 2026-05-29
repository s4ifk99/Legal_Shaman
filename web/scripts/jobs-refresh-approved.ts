import "./load-dotenv";
import { requireOpsEnvironment } from "../lib/ops/environment-guard";
import { runRefreshApprovedAndRecord } from "../lib/ops/jobs-refresh-approved";

async function main() {
  requireOpsEnvironment(process.argv);
  const result = await runRefreshApprovedAndRecord();
  console.info(JSON.stringify({ event: "jobs_refresh_approved", ...result }, null, 2));
  process.exit(result.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
