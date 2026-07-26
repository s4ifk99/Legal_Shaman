import "./load-dotenv";
import Module from "node:module";
const nm = Module as typeof Module & { _load: Function };
const load = nm._load;
nm._load = function (r: string, p: unknown, m: boolean) {
  if (r === "server-only") return {};
  return load(r, p, m);
};

async function main() {
  const { generateWikiAnswer, clearWikiAnswerCacheForTests } = await import(
    "../lib/wiki/generate-answer"
  );
  clearWikiAnswerCacheForTests();
  const q =
    "I cancelled a builder before work started and he wants £100 I never agreed. Do I owe him?";
  const w = await generateWikiAnswer(q);
  console.log(
    JSON.stringify(
      {
        mode: w.mode,
        pages: w.wikiPages.slice(0, 5).map((p) => p.title),
        preview: (w.answer || "").slice(0, 280),
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
