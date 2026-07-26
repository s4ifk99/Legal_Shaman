/**
 * Continuous parity eval: local wiki answers vs Ask the Shaman (legal-search).
 * Target: average similarity >= 0.90
 *
 *   npx tsx scripts/wiki-web-parity-eval.ts
 *   npx tsx scripts/wiki-web-parity-eval.ts --min=0.9 --rounds=3
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

const MIN = Number(
  process.argv.find((a) => a.startsWith("--min="))?.slice(6) ?? process.env.PARITY_MIN ?? 0.9,
);
const ROUNDS = Number(
  process.argv.find((a) => a.startsWith("--rounds="))?.slice(9) ?? process.env.PARITY_ROUNDS ?? 1,
);

const TRADESMAN_QUERY = `I contacted a tradesman to change tiles and we agreed on a certain date in advance (we agreed on the 30th of June to do the work on the 24th of July) then as the time approached, I reminded him but then he had other booked work during that day, so we rescheduled for Sunday. However before that we had a video call and I explained to him what needs to be done, but then I decided not to go ahead with this tiler a day before Sunday so Saturday afternoon (today) because I spoke to other tilers and realized that it’s better to remove the existing tiles and put new ones which this guy is insisting is not possible for some reason and other tilers are saying it’s possible and even recommended as putting tiles on top of tiles will cause the flooring to go up a bit and this could cause other issues in the room. Bottom line I cancelled with him.
Now he wants me to transfer £100 because we discussed the work according to him…I never agreed on this £100 prior.
I told him I want to cancel because I’m leaving the UK which is true and decided not to go ahead with the work. I might choose another tiler who can remove the existing tiles before I travel or I might not.
Do I owe him or he’s just being cheeky ?`;

const CASES: Array<{ id: string; query: string }> = [
  { id: "tradesman_cancel_fee", query: TRADESMAN_QUERY },
  { id: "cancel_service_short", query: "I cancelled a builder before work started and he wants £100 I never agreed. Do I owe him?" },
  { id: "deposit_return", query: "my landlord won't return my tenancy deposit after I moved out" },
  { id: "unfair_dismissal", query: "I was unfairly dismissed from my job without warning" },
  { id: "damp_mould", query: "my landlord won't fix damp and mould in my flat" },
  { id: "visa_refusal", query: "my UK visa application was refused what can I do" },
  { id: "child_contact", query: "I need help with child contact arrangements after separation" },
  { id: "small_claims", query: "how do I take a trader to small claims court for poor work" },
  { id: "parking_pcn", query: "I got a private parking charge notice from ParkingEye" },
  { id: "prenup", query: "I need a prenup before we get married in England" },
];

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9£$\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3);
}

function jaccard(a: string[], b: string[]): number {
  if (!a.length && !b.length) return 1;
  if (!a.length || !b.length) return 0;
  const A = new Set(a);
  const B = new Set(b);
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter / (A.size + B.size - inter);
}

function bigrams(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length - 1; i++) out.push(`${tokens[i]} ${tokens[i + 1]}`);
  return out;
}

function answerSimilarity(wikiAnswer: string, webAnswer: string): number {
  if (wikiAnswer === webAnswer) return 1;
  const wt = tokenize(wikiAnswer);
  const bt = tokenize(webAnswer);
  const uni = jaccard(wt, bt);
  const bi = jaccard(bigrams(wt), bigrams(bt));
  return 0.55 * uni + 0.45 * bi;
}

function pageOverlap(wikiIds: string[], webTitles: string[], wikiTitles: string[]): number {
  if (!wikiTitles.length && !webTitles.length) return 1;
  if (!wikiTitles.length || !webTitles.length) return 0;
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const W = new Set(wikiTitles.map(norm));
  const B = new Set(webTitles.map(norm));
  let inter = 0;
  for (const t of W) if (B.has(t)) inter += 1;
  const titleJ = inter / (W.size + B.size - inter);

  // Also accept partial title containment (wiki page title appears in web source title).
  let soft = 0;
  for (const w of W) {
    if ([...B].some((b) => b.includes(w) || w.includes(b))) soft += 1;
  }
  const softJ = soft / Math.max(W.size, B.size);
  return Math.max(titleJ, softJ);
}

type CaseResult = {
  id: string;
  similarity: number;
  answerSim: number;
  pageSim: number;
  wikiMode: string;
  webMode: string | undefined;
  wikiPreview: string;
  webPreview: string;
  pass: boolean;
};

async function runRound(round: number): Promise<{ avg: number; results: CaseResult[] }> {
  const { generateWikiAnswer } = await import("../lib/wiki/generate-answer");
  const { runLegalKnowledgeSearch } = await import("../lib/legal-knowledge/search");

  const results: CaseResult[] = [];
  for (const c of CASES) {
    const wiki = await generateWikiAnswer(c.query);
    const web = await runLegalKnowledgeSearch({
      query: c.query,
      includeDirectory: false,
    });

    const wikiText = (wiki.answer ?? wiki.message ?? "").trim();
    const webText = (web.answer ?? "").trim();
    const answerSim = answerSimilarity(wikiText, webText);
    const pageSim = pageOverlap(
      wiki.wikiPages.map((p) => p.id),
      web.sources.map((s) => s.title),
      wiki.wikiPages.map((p) => p.title),
    );
    // Prefer answer match; page overlap as secondary signal.
    const similarity = 0.7 * answerSim + 0.3 * pageSim;
    const pass = similarity >= MIN;

    results.push({
      id: c.id,
      similarity: Number(similarity.toFixed(3)),
      answerSim: Number(answerSim.toFixed(3)),
      pageSim: Number(pageSim.toFixed(3)),
      wikiMode: wiki.mode,
      webMode: web.answerMode,
      wikiPreview: wikiText.slice(0, 160),
      webPreview: webText.slice(0, 160),
      pass,
    });

    console.log(
      JSON.stringify({
        event: "parity_case",
        round,
        id: c.id,
        similarity,
        answerSim,
        pageSim,
        wikiMode: wiki.mode,
        webMode: web.answerMode,
        webDebugMode: web.debug?.mode,
        pass,
      }),
    );
  }

  const avg = results.reduce((s, r) => s + r.similarity, 0) / results.length;
  return { avg, results };
}

async function main() {
  console.log(
    JSON.stringify({
      event: "parity_start",
      min: MIN,
      rounds: ROUNDS,
      cases: CASES.length,
    }),
  );

  let bestAvg = 0;
  let best: CaseResult[] = [];

  for (let round = 1; round <= ROUNDS; round++) {
    const { avg, results } = await runRound(round);
    bestAvg = Math.max(bestAvg, avg);
    if (avg >= bestAvg) best = results;

    const passed = results.filter((r) => r.pass).length;
    console.log(
      JSON.stringify({
        event: "parity_round",
        round,
        avg: Number(avg.toFixed(3)),
        passed,
        total: results.length,
        failIds: results.filter((r) => !r.pass).map((r) => r.id),
        ok: avg >= MIN,
      }),
    );

    if (avg >= MIN) {
      console.log(
        JSON.stringify({
          event: "parity_done",
          ok: true,
          avg: Number(avg.toFixed(3)),
          min: MIN,
          round,
        }),
      );
      process.exit(0);
    }
  }

  console.log(
    JSON.stringify({
      event: "parity_done",
      ok: false,
      avg: Number(bestAvg.toFixed(3)),
      min: MIN,
      fails: best.filter((r) => !r.pass).map((r) => ({
        id: r.id,
        similarity: r.similarity,
        wikiMode: r.wikiMode,
        webMode: r.webMode,
        wikiPreview: r.wikiPreview,
        webPreview: r.webPreview,
      })),
    }),
  );
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
