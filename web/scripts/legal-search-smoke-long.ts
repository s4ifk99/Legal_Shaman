/**
 * Smoke: long tradesman query against local or prod legal-search.
 *
 * Usage:
 *   npx tsx scripts/legal-search-smoke-long.ts
 *   npx tsx scripts/legal-search-smoke-long.ts --url=https://www.legalshaman.com
 *   npx tsx scripts/legal-search-smoke-long.ts --local
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

const QUERY = `I contacted a tradesman to change tiles and we agreed on a certain date in advance (we agreed on the 30th of June to do the work on the 24th of July) then as the time approached, I reminded him but then he had other booked work during that day, so we rescheduled for Sunday. However before that we had a video call and I explained to him what needs to be done, but then I decided not to go ahead with this tiler a day before Sunday so Saturday afternoon (today) because I spoke to other tilers and realized that it’s better to remove the existing tiles and put new ones which this guy is insisting is not possible for some reason and other tilers are saying it’s possible and even recommended as putting tiles on top of tiles will cause the flooring to go up a bit and this could cause other issues in the room. Bottom line I cancelled with him.
Now he wants me to transfer £100 because we discussed the work according to him…I never agreed on this £100 prior.
I told him I want to cancel because I’m leaving the UK which is true and decided not to go ahead with the work. I might choose another tiler who can remove the existing tiles before I travel or I might not.
Do I owe him or he’s just being cheeky ?`;

async function smokeRemote(baseUrl: string) {
  const url = `${baseUrl.replace(/\/$/, "")}/api/legal-search`;
  const cookie = process.env.SMOKE_SESSION_COOKIE?.trim();
  const t0 = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify({ query: QUERY, includeDirectory: true }),
  });
  const raw = await res.text();
  const ms = Date.now() - t0;
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    console.info(
      JSON.stringify({
        event: "legal_search_smoke",
        mode: "remote",
        url,
        http: res.status,
        ms,
        json: false,
        preview: raw.slice(0, 200),
        ok: false,
      }),
    );
    process.exit(1);
  }
  if (res.status === 401) {
    console.info(
      JSON.stringify({
        event: "legal_search_smoke",
        mode: "remote",
        url,
        http: 401,
        ms,
        ok: false,
        error: "auth_required",
        hint: "Sign in on the site, or set SMOKE_SESSION_COOKIE for API smoke.",
      }),
    );
    process.exit(1);
  }
  const ok =
    res.ok &&
    Boolean(body.answer || body.answerMode) &&
    !String(body.error ?? "").toLowerCase().includes("timed out");
  console.info(
    JSON.stringify(
      {
        event: "legal_search_smoke",
        mode: "remote",
        url,
        http: res.status,
        ms,
        json: true,
        ok,
        error: body.error ?? null,
        answerMode: body.answerMode ?? null,
        confidence: body.confidence ?? null,
        answerLen: typeof body.answer === "string" ? body.answer.length : 0,
        directoryCount: Array.isArray(body.directoryResults)
          ? body.directoryResults.length
          : 0,
      },
      null,
      2,
    ),
  );
  process.exit(ok ? 0 : 1);
}

async function smokeLocal() {
  process.env.VERCEL = "1";
  process.env.ENABLE_LLM_ANSWER = process.env.ENABLE_LLM_ANSWER ?? "true";
  const { runLegalKnowledgeSearch } = await import("../lib/legal-knowledge/search");
  const t0 = Date.now();
  try {
    const result = await runLegalKnowledgeSearch({
      query: QUERY,
      includeDirectory: true,
    });
    const ms = Date.now() - t0;
    const ok = Boolean(result.answer || result.answerMode);
    console.info(
      JSON.stringify(
        {
          event: "legal_search_smoke",
          mode: "local_vercel_sim",
          ms,
          ok,
          answerMode: result.answerMode,
          confidence: result.confidence,
          answerLen: result.answer?.length ?? 0,
          directoryCount: result.directoryResults?.length ?? 0,
          taxonomy: result.issueClassification?.subArea ?? null,
          modeDebug: result.debug?.mode ?? null,
        },
        null,
        2,
      ),
    );
    process.exit(ok ? 0 : 1);
  } catch (e) {
    console.info(
      JSON.stringify({
        event: "legal_search_smoke",
        mode: "local_vercel_sim",
        ms: Date.now() - t0,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      }),
    );
    process.exit(1);
  }
}

async function main() {
  const urlArg = process.argv.find((a) => a.startsWith("--url="));
  const local = process.argv.includes("--local");
  console.info(JSON.stringify({ event: "legal_search_smoke_start", queryLen: QUERY.length }));
  if (urlArg) {
    await smokeRemote(urlArg.split("=").slice(1).join("=") || "https://www.legalshaman.com");
    return;
  }
  if (local || !urlArg) {
    await smokeLocal();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
