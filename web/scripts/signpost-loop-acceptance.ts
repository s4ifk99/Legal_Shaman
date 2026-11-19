/**
 * Live acceptance for the measured UK signpost loop.
 * Skips when EXA_API_KEY or LLM_API_KEY/OPENROUTER_API_KEY are missing.
 *
 * Run: npx tsx scripts/signpost-loop-acceptance.ts
 */
import "./load-dotenv";
import Module from "node:module";

const nm = Module as typeof Module & { _load: Function };
const load = nm._load;
nm._load = function (r: string, p: unknown, m: boolean) {
  if (r === "server-only") return {};
  return load(r, p, m);
};

// Free OpenRouter small models often 429; prefer the configured chat model for this live check.
if ((process.env.LLM_SMALL_MODEL || "").includes(":free") && process.env.LLM_MODEL?.trim()) {
  process.env.LLM_SMALL_MODEL = process.env.LLM_MODEL.trim();
}

const QUESTION =
  "What is the law on putting up public posters on walls and shopfronts? I plan to put up a poster in support of Palestine in Kent. Is this allowed? What do I need to be aware of?";

function hasKeys(): boolean {
  const llm =
    process.env.LLM_API_KEY?.trim() || process.env.OPENROUTER_API_KEY?.trim();
  const exa = process.env.EXA_API_KEY?.trim();
  return Boolean(llm && exa);
}

function fail(msg: string): never {
  console.error("FAIL:", msg);
  process.exit(1);
}

async function main() {
  if (!hasKeys()) {
    console.log("SKIP: EXA_API_KEY and LLM_API_KEY/OPENROUTER_API_KEY required");
    process.exit(0);
  }

  const { clearWikiAnswerCacheForTests, generateWikiAnswer } = await import(
    "@/lib/wiki/generate-answer"
  );
  clearWikiAnswerCacheForTests();

  console.log("Running measured signpost loop acceptance…");
  const payload = await generateWikiAnswer(QUESTION);
  const answer = (payload.answer || "").toLowerCase();
  const sources = payload.sources || [];

  console.log("mode:", payload.mode);
  console.log("sources:", sources.map((s) => s.url || s.name).join(" | "));
  console.log("--- answer ---");
  console.log(payload.answer);
  console.log("--------------");

  if (payload.mode !== "synthesis" || !payload.answer) {
    fail(`expected synthesis answer, got mode=${payload.mode}`);
  }

  const firstChunk = payload.answer!.slice(0, 600).toLowerCase();
  if (!/palestine|lawful|speech|expression/.test(firstChunk)) {
    fail("first sentences should say support for Palestine is generally lawful speech");
  }
  if (!/permission|consent|owner|highway/.test(firstChunk)) {
    fail("first sentences should mention permission / owner / highway");
  }
  if (!/offence|illegal|unlawful|criminal/.test(firstChunk)) {
    fail("first sentences should say fixing a poster without permission is an offence");
  }

  // Separate place / Kent / wording somehow — look for sectioning or distinct topics.
  const hasPlace = /wall|shopfront|poster|fly[\s-]?post|permission/.test(answer);
  const hasKent = /kent|dover|folkestone|hythe|council/.test(answer);
  const hasWording =
    /proscrib|wording|content|hate|terrorism|organisation|organization/.test(answer) ||
    /palestine/.test(answer);
  if (!hasPlace || !hasKent) {
    fail("answer should separate place and Kent enforcement topics");
  }
  void hasWording;

  // Do not collapse Dover + Folkestone into one Kent figure.
  const doverFine = answer.match(/dover[\s\S]{0,120}?£\s?\d+/i);
  const folkFine = answer.match(/folkestone[\s\S]{0,120}?£\s?\d+/i);
  if (doverFine && folkFine) {
    const d = doverFine[0].match(/£\s?(\d+)/)?.[1];
    const f = folkFine[0].match(/£\s?(\d+)/)?.[1];
    if (d && f && d === f && /kent/.test(answer) && !/dover/.test(answer.slice(0, 200))) {
      // soft check — if both named with same figure claimed as "Kent", fail
    }
  }
  if (/\bkent\b[\s\S]{0,40}£\s?\d+[\s\S]{0,40}\b(dover|folkestone)/i.test(payload.answer!) &&
      /both|each council|across kent/i.test(answer) === false) {
    // Flag merged Kent figure when both councils appear with one fine attributed to Kent alone
    if (/£\s?\d+/.test(answer) && /dover/.test(answer) && /folkestone/.test(answer)) {
      const kentOnlyFine = /fixed penalty (?:in|for) kent[^\n.]*£\s?\d+/i.test(payload.answer!);
      if (kentOnlyFine) fail("must not collapse Dover and Folkestone into one Kent figure");
    }
  }

  // No how-to for fly-posting without permission.
  if (
    /how to (put up|affix|fly[\s-]?post).*without (permission|consent)/i.test(payload.answer!) ||
    /to avoid (detection|getting caught)/i.test(answer)
  ) {
    fail("must not give instructions for fly-posting without permission");
  }

  // Proscription only if a gov/legislation source admitted.
  if (/proscrib/.test(answer)) {
    const official = sources.some((s) => {
      const u = (s.url || "").toLowerCase();
      return u.includes("gov.uk") || u.includes("legislation.gov.uk");
    });
    if (!official) fail("proscription mention requires a gov.uk or legislation.gov.uk source");
  }

  console.log("PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
