import "./load-dotenv";

import Module from "node:module";

type NodeLoad = (request: string, parent: unknown, isMain: boolean) => unknown;
const nodeModule = Module as typeof Module & { _load: NodeLoad };
const load = nodeModule._load;
nodeModule._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  return load(request, parent, isMain);
};

async function main() {
  const { requireOpsEnvironment } = await import("../lib/ops/environment-guard");
  const { runDailyJobs } = await import("../lib/ops/jobs-daily");
  requireOpsEnvironment(process.argv);
  const result = await runDailyJobs();
  console.info(JSON.stringify({ event: "jobs_daily", ...result }, null, 2));
  process.exit(result.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
