import "./load-dotenv";
import { requireOpsEnvironment } from "../lib/ops/environment-guard";
import { runDailyJobs } from "../lib/ops/jobs-daily";

async function main() {
  requireOpsEnvironment(process.argv);
  const result = await runDailyJobs();
  console.info(JSON.stringify({ event: "jobs_daily", ...result }, null, 2));
  process.exit(result.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
