import "server-only";

import { chat, llmConfigured } from "@/lib/llm/client";
import { sanitizeAdviceText } from "@/lib/guardrails/validator";
import { resolveLegalIssueFromQuery } from "@/lib/legal/taxonomy";
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
  return searchWikiPages(query, limit * 2)
    .filter((hit) => {
      const page = getWikiPageById(hit.id);
      return page ? !isQuarantinedPage(page) : true;
    })
    .slice(0, limit);
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

const INSUFFICIENT_MESSAGE =
  "We could not find enough matching material in the Legal Shaman wiki for this question. Try rephrasing (e.g. add a topic like housing, employment, or neighbour dispute), browse the categories below, or contact Citizens Advice for free guidance.";

const EXTERNAL_SIGNPOST =
  "Free starting points: [Citizens Advice](https://www.citizensadvice.org.uk/) and [Advicenow](https://www.advicenow.org.uk/). For private solicitors, use [Find a Lawyer](/search).";

export async function generateWikiAnswer(query: string): Promise<WikiAnswerPayload> {
  const started = Date.now();
  const trimmed = query.trim();
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

  if (!llmConfigured()) {
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
${wikiContext}`;

  try {
    const raw = await chat(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      { jsonMode: true, temperature: 0.2, maxTokens: 900 },
    );

    const parsed = parseLlmJson(raw);
    const answer = sanitizeAdviceText(parsed?.answer?.trim() ?? "");

    if (!answer) {
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

    let answerText = answer;
    if (recommendedFirms.length > 0 && !/find a lawyer|directory|private/i.test(answer)) {
      answerText += `\n\nFor private help, firms with indexed commentary on this topic are listed below — signposting only, not endorsements.`;
    }

    return {
      ...base,
      mode: "synthesis",
      answer: answerText,
      sources: mergedSources.slice(0, 10),
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    console.warn("[wiki.generate-answer] LLM failed:", err);
    return {
      ...base,
      mode: "retrieval_only",
      message: "Synthesised answer unavailable right now. Browse the wiki results below.",
      latencyMs: Date.now() - started,
    };
  }
}
