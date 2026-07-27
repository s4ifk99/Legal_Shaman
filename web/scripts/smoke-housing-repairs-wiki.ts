import "./load-dotenv";
import Module from "node:module";
const nm = Module as typeof Module & { _load: Function };
const load = nm._load;
nm._load = function (r: string, p: unknown, m: boolean) {
  if (r === "server-only") return {};
  return load(r, p, m);
};

const QUERY = `I live in a housing association flat with my aunt/uncle as joint tenants. The bathroom leaks into the kitchen, the bath is cracked, shower doesn't work, walls are falling apart. My co-tenant refuses access for repairs and has hoarding issues. Do I have to wait until they die for the HA to fix things? What are my rights on repairs and succession?`;

async function main() {
  const { searchWikiPages } = await import("../lib/wiki/search");
  const { generateWikiAnswer, clearWikiAnswerCacheForTests } = await import(
    "../lib/wiki/generate-answer"
  );
  clearWikiAnswerCacheForTests();

  const raw = searchWikiPages(QUERY, 10);
  console.log("raw hits", raw.slice(0, 8).map((h) => ({ title: h.title, score: h.score })));

  const w = await generateWikiAnswer(QUERY);
  console.log(
    JSON.stringify(
      {
        mode: w.mode,
        score: w.retrievalScore,
        pages: w.wikiPages.slice(0, 8).map((p) => p.title),
        preview: (w.answer || w.message || "").slice(0, 400),
      },
      null,
      2,
    ),
  );

  const { runLegalKnowledgeSearch } = await import("../lib/legal-knowledge/search");
  const web = await runLegalKnowledgeSearch({ query: QUERY, includeDirectory: true });
  console.log(
    JSON.stringify(
      {
        mode: web.answerMode,
        debugMode: web.debug?.mode,
        confidence: web.confidence,
        pages: web.sources.slice(0, 5).map((s) => s.title),
        directoryCount: web.directoryResults.length,
        preview: (web.answer || "").slice(0, 400),
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
