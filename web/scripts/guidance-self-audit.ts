/**
 * Run Ask the Shaman guidance self-audit (OpenRouter, env, canary, Typesense, SLO).
 *
 * Usage: npx tsx scripts/guidance-self-audit.ts
 *        npx tsx scripts/guidance-self-audit.ts --skip-canary
 */
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
  const { runGuidanceSelfAudit } = await import("../lib/ops/guidance-self-audit");
  const skipCanary = process.argv.includes("--skip-canary");
  const report = await runGuidanceSelfAudit({ skipCanary });
  console.info(JSON.stringify({ event: "guidance_self_audit_cli", ...report }, null, 2));
  process.exit(report.criticalOk ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
