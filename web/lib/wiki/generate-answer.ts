import "server-only";

import { enableLlmAnswer, resolveSynthesisModel } from "@/lib/llm/answer-config";
import { chat, llmConfigured } from "@/lib/llm/client";
import { sanitizeAdviceText } from "@/lib/guardrails/validator";
import { resolveLegalIssueFromQuery } from "@/lib/legal/taxonomy";
import { processSearchQuery } from "@/lib/legal-search/query-limits";
import {
  pickRecommendedFirms,
  resolvePracticeAreasForWikiQuery,
} from "./firm-recommendations";
import {
  WIKI_ANSWER_DISCLAIMER,
  type WikiAnswerFirm,
  type WikiAnswerPayload,
  type WikiAnswerSource,
} from "./answer-types";
import { getWikiPageById, searchWikiPages } from "./search";
import type { WikiPageIndex } from "./types";

const MIN_RETRIEVAL_SCORE = 4;
const RETRIEVAL_LIMIT = 8;
const CONTEXT_CHARS_PER_PAGE = 700;

const SYSTEM_PROMPT = `You are Ask the Shaman for Legal Shaman — a UK legal signposting assistant.

Rules:
- Use ONLY the WIKI CONTEXT below. Do not invent statutes, cases, deadlines, or procedures.
- Neutral signposting tone only. Never say "you should", "I recommend", or predict outcomes.
- Describe what sources and wiki pages explain — not personalised advice.
- If context is thin, say what is known and what is missing.
- Output valid JSON only:
{
  "answer": "2-4 short paragraphs in plain English",
  "wikiPageTitles": ["exact titles from context used"],
  "sourcePublishers": ["publisher names mentioned in context sources"]
}`;

function isQuarantinedPage(page: WikiPageIndex): boolean {
  const path = page.relativePath.toLowerCase();
  return path.includes("_quarantine") || path.includes("/firms/_quarantine/");
}

function filterHits(query: string, limit: number) {
  const searchQ = condenseWikiRetrievalQuery(query);
  return searchWikiPages(searchQ, limit * 2)
    .filter((hit) => {
      const page = getWikiPageById(hit.id);
      return page ? !isQuarantinedPage(page) : true;
    })
    .slice(0, limit);
}

/** Long Reddit-style posts dilute keyword search — keep topical anchors. */
function condenseWikiRetrievalQuery(query: string): string {
  const trimmed = query.replace(/\s+/g, " ").trim();
  if (trimmed.length < 320) return trimmed;

  const lower = trimmed.toLowerCase();
  const anchors: string[] = [];
  if (/\b(cancel|cancelled|cancellation|owe|transfer|booking fee)\b/i.test(lower)) {
    anchors.push("cancelling a service you've arranged", "cancellation rights", "cancel service");
  }
  if (/\b(tradesman|tiler|builder|plumber|electrician|trader|contractor)\b/i.test(lower)) {
    anchors.push("problems with services or traders", "poor service", "trader");
  }
  if (/\b(deposit|tenancy|landlord)\b/i.test(lower)) {
    anchors.push("tenancy deposit", "landlord", "deposit protection");
  }
  if (/\b(dismiss|employment|wage|employer|acas)\b/i.test(lower)) {
    anchors.push("unfair dismissal", "employment", "ACAS");
  }
  if (/\b(visa|asylum|immigration|home office)\b/i.test(lower)) {
    anchors.push("visa", "immigration", "home office");
  }
  if (/\b(prenup|divorce|child contact|custody)\b/i.test(lower)) {
    anchors.push("family", "prenup", "child arrangements");
  }

  if (anchors.length) {
    return [...new Set(anchors)].join(" ").slice(0, 220);
  }
  return trimmed.slice(0, 280);
}

function truncate(text: string, max: number): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 3)}...`;
}

function buildWikiContext(hits: ReturnType<typeof searchWikiPages>): string {
  return hits
    .map((hit, i) => {
      const page = getWikiPageById(hit.id);
      const contentSnippet = page?.content ? truncate(page.content, CONTEXT_CHARS_PER_PAGE) : "";
      const sources = page?.sources?.slice(0, 4).join("; ") ?? "";
      return [
        `### Page ${i + 1}: ${hit.title} (category: ${hit.category})`,
        hit.summary ? `Summary: ${hit.summary}` : "",
        hit.keyInformation.length
          ? `Key information:\n- ${hit.keyInformation.join("\n- ")}`
          : "",
        hit.practicalGuidance.length
          ? `Practical guidance:\n- ${hit.practicalGuidance.join("\n- ")}`
          : "",
        sources ? `Sources: ${sources}` : "",
        contentSnippet ? `Excerpt: ${contentSnippet}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n---\n\n");
}

function collectSources(hits: ReturnType<typeof searchWikiPages>): WikiAnswerSource[] {
  const seen = new Set<string>();
  const sources: WikiAnswerSource[] = [];

  for (const hit of hits) {
    const page = getWikiPageById(hit.id);
    for (const raw of page?.sources ?? []) {
      const name = raw
        .replace(/\*\*/g, "")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/`[^`]+`/g, "")
        .trim();
      const key = name.toLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);
      sources.push({ name: truncate(name, 180) });
      if (sources.length >= 8) return sources;
    }
  }

  return sources;
}

function mapFirms(
  firms: ReturnType<typeof pickRecommendedFirms>,
): WikiAnswerFirm[] {
  return firms.map((row) => ({
    firm: row.firm,
    practiceArea: row.practiceArea,
    articleCount: row.article_count,
    directoryUrl: row.directory_url,
    entityId: row.sra_id ? `sra:${row.sra_id}` : undefined,
    resultSource: row.sra_id ? ("sra" as const) : undefined,
  }));
}

type LlmAnswerJson = {
  answer?: string;
  wikiPageTitles?: string[];
  sourcePublishers?: string[];
};

function parseLlmJson(raw: string): LlmAnswerJson | null {
  try {
    return JSON.parse(raw) as LlmAnswerJson;
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as LlmAnswerJson;
    } catch {
      return null;
    }
  }
}

function isJunkAnswer(text: string): boolean {
  const t = text.trim();
  if (t.length < 60) return true;
  if (/^["'}{\\]/.test(t)) return true;
  if (/answer in json format|as specified in the rules|\/\/\s*legal shaman|<\/?answer>/i.test(t)) {
    return true;
  }
  if ((t.match(/[{}`]/g) ?? []).length >= 4) return true;
  // Mostly meta / instruction echo rather than guidance prose
  const letters = (t.match(/[a-zA-Z]/g) ?? []).length;
  if (letters < 40) return true;
  return false;
}

/** Stable prose from wiki hits — used when LLM is off or returns junk. */
function deterministicAnswerFromHits(
  hits: ReturnType<typeof searchWikiPages>,
): string {
  const primary = hits[0];
  const secondary = hits[1];
  const paragraphs: string[] = [];

  if (primary?.summary?.trim()) {
    paragraphs.push(
      `According to “${primary.title}”: ${truncate(primary.summary.replace(/\s+/g, " ").trim(), 420)}`,
    );
  } else if (primary) {
    paragraphs.push(`Matching wiki guidance includes “${primary.title}”.`);
  }

  const keys = (primary?.keyInformation ?? []).slice(0, 2);
  if (keys.length) {
    paragraphs.push(`Key points from that page: ${keys.map((k) => k.replace(/\s+/g, " ").trim()).join(" ")}`);
  }

  const steps = (primary?.practicalGuidance ?? []).slice(0, 2);
  if (steps.length) {
    paragraphs.push(
      `Practical guidance noted there includes: ${steps.map((s) => s.replace(/\s+/g, " ").trim()).join(" ")}`,
    );
  }

  if (secondary?.summary?.trim()) {
    paragraphs.push(
      `Related page “${secondary.title}”: ${truncate(secondary.summary.replace(/\s+/g, " ").trim(), 280)}`,
    );
  }

  paragraphs.push(
    "This is general signposting from the Legal Shaman wiki — not legal advice. Check the cited pages or Citizens Advice for personalised help.",
  );

  return sanitizeAdviceText(paragraphs.filter((p) => p.length >= 40).join("\n\n"));
}

const INSUFFICIENT_MESSAGE =
  "We could not find enough matching material in the Legal Shaman wiki for this question. Try rephrasing (e.g. add a topic like housing, employment, or neighbour dispute), browse the categories below, or contact Citizens Advice for free guidance.";

const EXTERNAL_SIGNPOST =
  "Free starting points: [Citizens Advice](https://www.citizensadvice.org.uk/) and [Advicenow](https://www.advicenow.org.uk/). For private solicitors, use [Find a Lawyer](/search).";

/** Short-lived cache so Ask the Shaman and `/api/ask/answer` return identical text for the same query. */
const answerCache = new Map<string, Promise<WikiAnswerPayload>>();
const ANSWER_CACHE_TTL_MS = 90_000;

async function generateWikiAnswerUncached(query: string): Promise<WikiAnswerPayload> {
  const started = Date.now();
  const trimmed = processSearchQuery(query);
  const hits = filterHits(trimmed, RETRIEVAL_LIMIT);
  const retrievalScore = hits[0]?.score ?? 0;
  const sources = collectSources(hits);
  const recommendedFirms = mapFirms(pickRecommendedFirms(trimmed, hits));
  const practiceAreas = resolvePracticeAreasForWikiQuery(trimmed, hits);

  const base: WikiAnswerPayload = {
    query: trimmed,
    mode: "retrieval_only",
    answer: null,
    wikiPages: hits,
    sources,
    recommendedFirms,
    disclaimer: WIKI_ANSWER_DISCLAIMER,
    retrievalScore,
    latencyMs: 0,
  };

  if (hits.length === 0 || retrievalScore < MIN_RETRIEVAL_SCORE) {
    return {
      ...base,
      mode: "insufficient",
      message: `${INSUFFICIENT_MESSAGE}\n\n${EXTERNAL_SIGNPOST}`,
      latencyMs: Date.now() - started,
    };
  }

  const firmTail =
    recommendedFirms.length > 0
      ? `\n\nFor private help, firms with indexed commentary on this topic are listed below — signposting only, not endorsements.`
      : "";

  const finishSynthesis = (answer: string): WikiAnswerPayload => ({
    ...base,
    mode: "synthesis",
    answer: `${answer}${firmTail && !/find a lawyer|directory|private/i.test(answer) ? firmTail : ""}`,
    sources,
    latencyMs: Date.now() - started,
  });

  if (!llmConfigured() || !enableLlmAnswer()) {
    const deterministic = deterministicAnswerFromHits(hits);
    if (deterministic.length >= 80) return finishSynthesis(deterministic);
    return {
      ...base,
      mode: "retrieval_only",
      message:
        "Wiki pages matched your question. Set LLM_API_KEY and LLM_BASE_URL in web/.env.local (OpenRouter) to enable synthesised answers.",
      latencyMs: Date.now() - started,
    };
  }

  const taxonomy = resolveLegalIssueFromQuery(trimmed);
  const wikiContext = buildWikiContext(hits);
  const firmContext =
    recommendedFirms.length > 0
      ? recommendedFirms
          .map(
            (f) =>
              `- ${f.firm} (${f.practiceArea}, ${f.articleCount} indexed articles) — directory: ${f.directoryUrl}`,
          )
          .join("\n")
      : "None matched for this query.";

  const userPrompt = `USER QUESTION:\n${trimmed}

LIKELY PRACTICE AREAS: ${practiceAreas.join(", ") || "unknown"}
TAXONOMY HINT: ${taxonomy?.canonicalName ?? "none"}

RECOMMENDED FIRMS (signposting only — mention only if relevant to the question):
${firmContext}

WIKI CONTEXT:
${wikiContext}

Respond with JSON only. The "answer" field must be 2-4 plain-English paragraphs of signposting — never instructions, never code, never commentary about JSON.`;

  try {
    const raw = await chat(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      {
        jsonMode: true,
        temperature: 0,
        maxTokens: 900,
        model: resolveSynthesisModel(),
      },
    );

    const parsed = parseLlmJson(raw);
    let answer = sanitizeAdviceText(parsed?.answer?.trim() ?? "");
    if (!answer) {
      const plain = raw.trim();
      if (plain && !plain.startsWith("{")) {
        answer = sanitizeAdviceText(plain);
      }
    }

    if (!answer || isJunkAnswer(answer)) {
      const deterministic = deterministicAnswerFromHits(hits);
      if (deterministic.length >= 80) return finishSynthesis(deterministic);
      return {
        ...base,
        mode: "retrieval_only",
        message: "Could not generate a summary. Browse the matching wiki pages below.",
        latencyMs: Date.now() - started,
      };
    }

    const publisherSources = (parsed?.sourcePublishers ?? [])
      .map((name) => sanitizeAdviceText(name.trim()))
      .filter(Boolean)
      .map((name) => ({ name }));

    const mergedSources = [...sources];
    for (const row of publisherSources) {
      if (!mergedSources.some((s) => s.name.toLowerCase() === row.name.toLowerCase())) {
        mergedSources.push(row);
      }
    }

    const synthesised = finishSynthesis(answer);
    return { ...synthesised, sources: mergedSources.slice(0, 10) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[wiki.generate-answer] LLM failed:", message);
    const deterministic = deterministicAnswerFromHits(hits);
    if (deterministic.length >= 80) return finishSynthesis(deterministic);
    return {
      ...base,
      mode: "retrieval_only",
      message: `Synthesised answer unavailable (${message}). Browse the wiki results below.`,
      latencyMs: Date.now() - started,
    };
  }
}

export async function generateWikiAnswer(query: string): Promise<WikiAnswerPayload> {
  const key = processSearchQuery(query).toLowerCase();
  const existing = answerCache.get(key);
  if (existing) return existing;

  const pending = generateWikiAnswerUncached(query).finally(() => {
    setTimeout(() => {
      if (answerCache.get(key) === pending) answerCache.delete(key);
    }, ANSWER_CACHE_TTL_MS);
  });
  answerCache.set(key, pending);
  return pending;
}

/** Test helper — clears the short-lived answer cache. */
export function clearWikiAnswerCacheForTests(): void {
  answerCache.clear();
}
