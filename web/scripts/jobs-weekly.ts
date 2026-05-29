import "./load-dotenv";
import { parseOpsCliFlags, requireOpsEnvironment } from "../lib/ops/environment-guard";
import { runWeeklyJobs } from "../lib/ops/jobs-weekly";

async function main() {
  requireOpsEnvironment(process.argv);
  const flags = parseOpsCliFlags(process.argv);
  const result = await runWeeklyJobs({ force: flags.force });
  console.info(JSON.stringify({ event: "jobs_weekly", ...result }, null, 2));
  process.exit(result.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
