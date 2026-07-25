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
  const { printEnvironmentSnapshot, requireOpsEnvironment } = await import(
    "../lib/ops/environment-guard"
  );
  const { runProdHealth } = await import("../lib/ops/prod-health");
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
