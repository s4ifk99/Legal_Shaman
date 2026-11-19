import "./load-dotenv";
import Module from "node:module";

const nm = Module as typeof Module & { _load: Function };
const load = nm._load;
nm._load = function (r: string, p: unknown, m: boolean) {
  if (r === "server-only") return {};
  return load(r, p, m);
};

if ((process.env.LLM_SMALL_MODEL || "").includes(":free") && process.env.LLM_MODEL?.trim()) {
  process.env.LLM_SMALL_MODEL = process.env.LLM_MODEL.trim();
}

const Q =
  "What is the law on putting up public posters on walls and shopfronts? I plan to put up a poster in support of Palestine in Kent. Is this allowed? What do I need to be aware of?";

async function main() {
  const { classifySignpostQuestion } = await import("../lib/wiki/signpost-loop/classify");
  const {
    searchWikiCandidatesForFacets,
    searchExaCandidatesForFacets,
  } = await import("../lib/wiki/signpost-loop/retrieve");
  const { judgeAdmitCandidates, applyAdmitJudgments } = await import(
    "../lib/wiki/signpost-loop/admit"
  );

  const c = await classifySignpostQuestion(Q);
  console.log("classification", JSON.stringify(c, null, 2));
  const wiki = searchWikiCandidatesForFacets(c.facets);
  console.log(
    "wiki candidates",
    wiki.length,
    wiki.map((w) => ({ f: w.facetId, t: w.title.slice(0, 60) })),
  );
  const wikiJ = await judgeAdmitCandidates(Q, c.facets, wiki);
  console.log("wiki judgments", wikiJ);
  let admitted = applyAdmitJudgments(wiki, wikiJ);
  console.log("admitted after wiki", admitted.length);
  const needing = new Set(
    c.facets.filter((f) => !admitted.some((a) => a.facetId === f.id)).map((f) => f.id),
  );
  console.log("needing exa", [...needing]);
  const exa = await searchExaCandidatesForFacets(c.facets, needing);
  console.log(
    "exa candidates",
    exa.length,
    exa.slice(0, 10).map((e) => ({ f: e.facetId, u: e.url, t: e.title.slice(0, 50) })),
  );
  const exaJ = await judgeAdmitCandidates(
    Q,
    c.facets.filter((f) => needing.has(f.id)),
    exa,
  );
  console.log("exa judgments", exaJ);
  admitted = [...admitted, ...applyAdmitJudgments(exa, exaJ)];
  console.log(
    "admitted total",
    admitted.map((a) => ({ f: a.facetId, u: a.url })),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
