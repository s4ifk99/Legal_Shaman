/**
 * Quick local check: wiki retrieval + topical overlap for the tradesman cancel query.
 * Run: npx tsx scripts/smoke-wiki-fallback.ts
 */
import "./load-dotenv";

import Module from "node:module";

const nm = Module as typeof Module & { _load: Function };
const load = nm._load;
nm._load = function (r: string, p: unknown, m: boolean) {
  if (r === "server-only") return {};
  return load(r, p, m);
};

const QUERY = `I contacted a tradesman to change tiles and we agreed on a certain date in advance (we agreed on the 30th of June to do the work on the 24th of July) then as the time approached, I reminded him but then he had other booked work during that day, so we rescheduled for Sunday. However before that we had a video call and I explained to him what needs to be done, but then I decided not to go ahead with this tiler a day before Sunday so Saturday afternoon (today) because I spoke to other tilers and realized that it’s better to remove the existing tiles and put new ones which this guy is insisting is not possible for some reason and other tilers are saying it’s possible and even recommended as putting tiles on top of tiles will cause the flooring to go up a bit and this could cause other issues in the room. Bottom line I cancelled with him.
Now he wants me to transfer £100 because we discussed the work according to him…I never agreed on this £100 prior.
Do I owe him or he’s just being cheeky ?`;

async function main() {
  const { deriveLegalSearchIntent } = await import("../lib/legal-knowledge/search-intent");
  const { buildLegalSearchContext } = await import("../lib/legal-knowledge/search-context");
  const { retrieveWikiAsChunks, wikiSearchQueryForIntent } = await import(
    "../lib/legal-knowledge/wiki-retrieval"
  );
  const { assembleFromKnowledgeGraph } = await import(
    "../lib/knowledge-compiler/assemble-answer"
  );
  const { generateCitationFirstAnswer } = await import(
    "../lib/legal-knowledge/generate-answer"
  );

  const context = await buildLegalSearchContext({ query: QUERY, includeDirectory: false });
  const intent = deriveLegalSearchIntent(context);
  console.log("intent", {
    slug: intent.taxonomySlug,
    specific: intent.specificIssue,
    semantic: intent.semanticQuery,
    boost: intent.searchBoostTerms.slice(0, 6),
  });
  console.log("wikiSearchQ", wikiSearchQueryForIntent(QUERY, intent));

  const wiki = retrieveWikiAsChunks(QUERY, { limit: 8, intent });
  console.log(
    "wikiChunks",
    wiki.map((c) => ({ title: c.title, score: c.finalScore.toFixed(2) })),
  );

  const graph = await assembleFromKnowledgeGraph(context, intent);
  console.log(
    "graph",
    graph
      ? {
          confidence: graph.confidence,
          primary: graph.conceptCluster.primary.title,
          answerPreview: graph.answer.slice(0, 220),
        }
      : null,
  );

  const answer = await generateCitationFirstAnswer(QUERY, wiki, 0.55, intent);
  console.log("answerMode", answer.mode);
  console.log("answerPreview", answer.answer.slice(0, 400));
  console.log("sources", answer.sources.map((s) => s.title).slice(0, 4));

  const { runLegalKnowledgeSearch } = await import("../lib/legal-knowledge/search");
  const full = await runLegalKnowledgeSearch({ query: QUERY, includeDirectory: false });
  console.log("fullSearch", {
    mode: full.answerMode,
    confidence: full.confidence,
    sources: full.sources.slice(0, 3).map((s) => s.title),
    preview: full.answer.slice(0, 350),
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
