import "./load-dotenv";
import Module from "node:module";
const nm = Module as typeof Module & { _load: Function };
const load = nm._load;
nm._load = function (r: string, p: unknown, m: boolean) {
  if (r === "server-only") return {};
  return load(r, p, m);
};

const q =
  process.argv[2] ??
  "My mother purchased taps on Temu containing lead. I tested them and they are all containing lead.";

async function main() {
  process.env.SEARCH_ROUTE_MODE = "satnav";
  const { runLegalKnowledgeSearch } = await import("../lib/legal-knowledge/search");
  const t0 = Date.now();
  const r = await runLegalKnowledgeSearch({ query: q, includeDirectory: false });
  console.log("\n=== Satnav search try ===\n");
  console.log("Query:", q.slice(0, 100) + (q.length > 100 ? "…" : ""));
  console.log("Mode:", r.debug?.searchRouteMode);
  console.log("LLM each stage:", r.debug?.satnavLlmEachStage ?? false);
  console.log("Decision:", r.debug?.routeDecision);
  const stages = r.debug?.llmStages;
  if (stages) {
    console.log("Decided by:", stages.decidedBy ?? "arbiter");
    console.log("Synthesis:", stages.synthesis ?? "unknown");
    if (stages.planner) {
      console.log("LLM planner:", {
        refined: stages.planner.refinedQueries?.length ?? 0,
        added: stages.planner.addedRoutes?.length ?? 0,
        error: stages.planner.error,
      });
    }
    if (stages.rerank?.length) {
      console.log(
        "LLM rerank:",
        stages.rerank.map((x) => `${x.routeId}→${x.rankedHitIds[0]?.split("/").pop() ?? "?"}`).join(", "),
      );
    }
    if (stages.advisor) {
      console.log("LLM route advice:", {
        chosenRouteIds: stages.advisor.chosenRouteIds,
        decision: stages.advisor.decision,
        confidence: stages.advisor.confidence,
        error: stages.advisor.error,
      });
    }
  } else if (r.debug?.llmRouteAdvice) {
    console.log("LLM route advice:", r.debug.llmRouteAdvice);
  }
  console.log("Chosen routes:", r.debug?.chosenRouteIds?.join(", "));
  console.log("Rationale:", r.debug?.routeRationale);
  console.log("\nRoutes considered:");
  for (const route of r.debug?.routesConsidered ?? []) {
    console.log(`  - ${route.id} (${route.score}) → ${route.topTitle ?? "(no hit)"}`);
  }
  console.log("\nPrimary source:", r.sources[0]?.title);
  console.log("Sources:", r.sources.length);
  const answer = r.answer ?? "";
  console.log("\nAnswer length:", answer.length, "chars");
  console.log("\n--- Full answer ---\n");
  console.log(answer || "(no answer)");
  console.log("\n--- end ---");
  console.log("\nTraining log: reports/satnav-training/routes.jsonl (if SATNAV_TRAINING_LOG enabled)");
  console.log("\nLatency ms:", Date.now() - t0);
}

main().catch(console.error);
