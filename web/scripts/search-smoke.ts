/**
 * Live search smoke tests (Typesense + directory pipeline).
 * Run: cd web && npm run search:smoke
 */
import "./load-dotenv";

/** Allow importing server-only modules from Node CLI (not a Client Component). */
import Module from "node:module";

type NodeLoad = (request: string, parent: unknown, isMain: boolean) => unknown;
const nodeModule = Module as typeof Module & { _load: NodeLoad };
const load = nodeModule._load;
nodeModule._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  return load(request, parent, isMain);
};

import { ruleBasedParse } from "../lib/legal-search/query-rules";
import { detectVagueLegalQuery } from "../lib/legal-search/vague-query-rescue";
import { getSearchStackStatus } from "../lib/legal-search/search-startup";

const SMOKE_QUERIES = [
  "i need a prison lawyer",
  "employment advice",
  "housing help",
  "family solicitor",
  "immigration problem",
  "legal aid",
  "prison lawyer",
  "immigration solicitor",
  "legal aid housing",
] as const;

const DIRECTORY_SMOKE = [
  "i need a prison lawyer",
  "employment advice",
  "housing help",
  "family solicitor",
  "immigration problem",
  "legal aid",
  "prison lawyer",
  "immigration solicitor",
  "legal aid housing",
  "divorce lawyer Manchester",
] as const;

async function main() {
  let failed = 0;
  const fail = (msg: string) => {
    console.error(`FAIL ${msg}`);
    failed++;
  };

  const stack = await getSearchStackStatus();
  console.info(JSON.stringify({ event: "search_smoke_stack", ...stack }));

  if (stack.directorySearchBackend === "postgres") {
    if (!process.env.DATABASE_URL?.trim()) {
      fail("DATABASE_URL is not set — required for postgres directory search");
    }
  } else {
    if (!stack.enableTypesenseUnified) {
      fail("ENABLE_TYPESENSE_UNIFIED is not true — set in .env.local for local Typesense dev");
    }
    if (!stack.typesenseReachable) {
      fail("Typesense is not reachable");
    }
    if (!stack.legalEntitiesCollectionExists || (stack.legalEntitiesDocumentCount ?? 0) === 0) {
      fail("legal_entities collection missing or empty");
    }
  }

  for (const query of SMOKE_QUERIES) {
    const parsed = ruleBasedParse(query);
    if (!parsed.taxonomySlug) {
      if (["i need a prison lawyer", "employment advice", "housing help", "immigration problem", "legal aid"].includes(query)) {
        if (!parsed.taxonomySlug) fail(`taxonomy expected for "${query}"`);
      }
    }
    if (detectVagueLegalQuery(parsed) && parsed.queryConfidence !== "medium") {
      fail(`vague query should be medium confidence: "${query}"`);
    }
  }

  const { runDirectorySearch } = await import("../lib/legal-search/run-directory-search");

  for (const query of DIRECTORY_SMOKE) {
    try {
      const dir = await runDirectorySearch({ query, limit: 20, semantic: false });
      if (dir.results.length === 0) {
        fail(`zero directory results for "${query}" (degraded: ${dir.degradedModes.join(",")})`);
      }
      for (const r of dir.results) {
        if (!r.title?.trim()) fail(`missing title for "${query}"`);
        if (!r.explanation?.trim()) fail(`missing explanation for "${query}" / ${r.id}`);
      }
      const hasRefinement =
        Boolean(dir.parsedQuery.refinementChips?.length) ||
        Boolean(dir.parsedQuery.refinementQuestion?.trim()) ||
        Boolean(dir.parsedQuery.taxonomySummary?.trim());
      if (
        detectVagueLegalQuery(dir.parsedQuery) &&
        !hasRefinement
      ) {
        fail(`vague query should include refinement prompt: "${query}"`);
      }
      console.info(
        JSON.stringify({
          event: "search_smoke_query",
          query,
          count: dir.results.length,
          engine: stack.activeDirectoryEngine,
          degraded: dir.degradedModes,
          taxonomy: dir.parsedQuery.taxonomySlug,
          vague: detectVagueLegalQuery(dir.parsedQuery),
        }),
      );
    } catch (e) {
      fail(`crash on "${query}": ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  console.log(failed === 0 ? "search:smoke OK" : `search:smoke FAILED (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
