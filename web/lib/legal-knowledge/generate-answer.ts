import "server-only";

import { enableLlmAnswer, resolveSynthesisModel } from "@/lib/llm/answer-config";
import { chat, llmConfigured } from "@/lib/llm/client";
import { isHomeOllamaBaseUrl, resolveLlmBaseUrl } from "@/lib/llm/openrouter";
import { sanitizeAdviceText } from "@/lib/guardrails/validator";
import { normalizeLegalSourceUrl } from "@/lib/wiki/public-url";

import { buildSnippet } from "./chunker";
import {
  cleanChunkForProse,
  pickChunksForFallback,
  rankChunksForAnswer,
} from "./clean-prose";
import {
  chunkMatchesIntent,
  filterChunksByIntent,
  type LegalSearchIntent,
} from "./search-intent";
import type { LegalSearchSourceHit, RetrievedChunk } from "./types";
import { LEGAL_SEARCH_DISCLAIMER } from "./types";

const SYSTEM_PROMPT = `You are Legal Shaman — a UK legal information signposting assistant.

Rules:
- Use ONLY the SOURCES below. Do not invent statutes, cases, deadlines, fees, or procedures.
- This is legal information and signposting, NOT legal advice.
- Write exactly 2-4 short paragraphs separated by a blank line (\\n\\n). Each paragraph should be 2-4 sentences.
- Cite sources inline as [1], [2] matching the source numbers provided — at least one citation per paragraph where possible.
- Paragraph 1: what the retrieved guidance says about the issue. Paragraph 2: practical next steps from sources. Optional paragraphs: directory/help routes or gaps in the sources.
- Do not use bullet lists or numbered lists in the answer — prose paragraphs only.
- Separate legal information from suggestions to contact a lawyer or advice service.
- If sources are thin or conflicting, say so plainly in its own sentence.
- Mention emergency routes (999, domestic abuse helpline, Shelter) only when clearly relevant in the sources.
- Neutral tone. Never say "you should", "I recommend", or predict outcomes.
- Output valid JSON only:
{
  "answer": "Paragraph one.\\n\\nParagraph two.\\n\\nParagraph three.",
  "usedSourceIndexes": [1, 2]
}`;

type AnswerJson = {
  answer?: string;
  usedSourceIndexes?: number[];
};

function buildSourceContext(chunks: RetrievedChunk[]): string {
  return chunks
    .map((chunk, i) => {
      const idx = i + 1;
      return [
        `### Source [${idx}]`,
        `Title: ${chunk.title}`,
        chunk.heading ? `Section: ${chunk.heading}` : "",
        `Publisher: ${chunk.sourceName}`,
        `URL: ${chunk.sourceUrl}`,
        `Excerpt: ${buildSnippet(chunk.chunkText, 900)}`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n---\n\n");
}

function intentFallbackAnswer(query: string, intent?: LegalSearchIntent): string | null {
  if (!intent?.taxonomySlug) return null;
  if (intent.taxonomySlug === "employment") {
    const issue = intent.specificIssue ?? "an employment pay or workplace issue";
    return [
      `This looks like ${issue}. ACAS offers free guidance on many workplace disputes and early conciliation before an employment tribunal claim.`,
      "GOV.UK and Citizens Advice also publish information on pay, dismissal, and employment rights.",
      "These points are general signposting only — not legal advice. Use the directory below for regulated employment solicitors if you need personal help.",
    ].join("\n\n");
  }
  if (intent.taxonomySlug === "housing") {
    return [
      "Shelter and Citizens Advice publish free guidance on private renting, deposits, eviction, and repairs.",
      "These points are general signposting only — not legal advice. The directory lists regulated housing solicitors if you need personal help.",
    ].join("\n\n");
  }
  if (
    intent.taxonomySlug === "consumer" ||
    intent.taxonomySlug === "consumer_services" ||
    intent.taxonomySlug?.startsWith("consumer_")
  ) {
    const issue = intent.specificIssue ?? "a consumer or trader dispute";
    return [
      `This looks like ${issue}. Citizens Advice publishes free guidance on cancelling services you have arranged, complaining about traders, and using the Consumer Rights Act when work is not as agreed.`,
      "Whether money is owed often depends on whether a contract or fee was agreed in advance, what work was done, and any cancellation terms — check the cited sources rather than relying on a verbal demand alone.",
      "These points are general signposting only — not legal advice. Use the directory below for regulated consumer solicitors if you need personal help.",
    ].join("\n\n");
  }
  return null;
}

function fallbackAnswer(
  query: string,
  chunks: RetrievedChunk[],
  intent?: LegalSearchIntent,
): string {
  if (!chunks.length) {
    const intentFallback = intentFallbackAnswer(query, intent);
    if (intentFallback) return intentFallback;
    return "I could not find enough curated UK legal guidance to answer this confidently.\n\nTry rephrasing your question or use the directory results below to find regulated help.";
  }

  const onTopic = intent
    ? chunks.filter((c) => chunkMatchesIntent(c, intent))
    : chunks;
  const picked = pickChunksForFallback(query, onTopic.length ? onTopic : chunks, 2);
  const q = query.toLowerCase();
  const paragraphs: string[] = [];

  if (!picked.length) {
    const intentFallback = intentFallbackAnswer(query, intent);
    if (intentFallback) return intentFallback;
    return "I could not find enough curated UK legal guidance to answer this confidently.\n\nTry rephrasing your question or use the directory results below to find regulated help.";
  }

  if (/\bdeposit\b/.test(q)) {
    const detail = cleanChunkForProse(picked[0]!.chunkText, 2);
    const onTopicDeposit =
      /\bdeposit\b/i.test(picked[0]!.title) ||
      (detail && /\bdeposit\b/i.test(detail));

    if (onTopicDeposit && detail) {
      paragraphs.push(
        `When a private landlord holds a tenancy deposit, the returned amount and timing are governed by tenancy deposit protection rules. ${detail} [1].`,
      );
    } else {
      paragraphs.push(
        "When a private landlord holds a tenancy deposit, the money must usually be protected in an approved scheme and returned at the end of the tenancy unless lawful deductions apply. Citizens Advice and Shelter publish free guidance on deposit disputes if you need more detail.",
      );
    }
  } else if (intent?.taxonomySlug === "employment") {
    const detail = cleanChunkForProse(picked[0]!.chunkText, 2);
    const issue = intent.specificIssue ?? "employment rights";
    paragraphs.push(
      detail
        ? `On ${issue}, the cited guidance notes: ${detail} [1].`
        : `For ${issue}, ACAS and GOV.UK publish free workplace guidance [1].`,
    );
  } else if (/\b(evict|section 21|section 8|possession)\b/.test(q)) {
    const detail = cleanChunkForProse(picked[0]!.chunkText, 2);
    paragraphs.push(
      detail
        ? `Eviction and possession rules set out when a landlord can end a tenancy and what notice is required. ${detail} [1].`
        : "Eviction and possession rules set out when a landlord can end a tenancy and what notice is required [1].",
    );
  } else if (/\b(disrepair|damp|mould|repair)\b/.test(q)) {
    const detail = cleanChunkForProse(picked[0]!.chunkText, 2);
    paragraphs.push(
      detail
        ? `Tenants may have rights when a rented home needs repairs or is unsafe. ${detail} [1].`
        : "Tenants may have rights when a rented home needs repairs or is unsafe [1].",
    );
  } else {
    const detail = cleanChunkForProse(picked[0]!.chunkText, 2);
    paragraphs.push(detail ? `${detail} [1].` : `See ${picked[0]!.title} for guidance on this issue [1].`);
  }

  if (picked[1]) {
    const extra = cleanChunkForProse(picked[1].chunkText, 2);
    if (extra && (!/\bdeposit\b/.test(q) || /\bdeposit\b/i.test(extra))) {
      paragraphs.push(`${extra} [2].`);
    }
  }

  const tail =
    intent?.taxonomySlug === "employment"
      ? "These points are general signposting only — not legal advice. ACAS offers free conciliation for many disputes; the directory lists regulated employment solicitors."
      : intent?.taxonomySlug === "housing"
        ? "These points come only from the cited pages below — not legal advice. Citizens Advice and Shelter publish free housing guidance."
        : "These points come only from the cited pages below — not legal advice.";

  paragraphs.push(tail);
  return paragraphs.join("\n\n");
}

function mapSourceHits(chunks: RetrievedChunk[]): LegalSearchSourceHit[] {
  return chunks.map((c) => ({
    title: c.heading ? `${c.title} — ${c.heading}` : c.title,
    url: normalizeLegalSourceUrl(c.sourceUrl),
    source: c.sourceName,
    snippet: c.snippet,
    score: Number(c.finalScore.toFixed(4)),
    heading: c.heading,
  }));
}

/** Keep cited sources aligned with the user's issue. */
export function filterChunksForQuery(
  query: string,
  chunks: RetrievedChunk[],
  intent?: LegalSearchIntent,
): RetrievedChunk[] {
  if (!chunks.length) return chunks;

  if (intent?.requiredTopicTerms.length) {
    const byIntent = filterChunksByIntent(chunks, intent);
    if (byIntent.length) return rankChunksForAnswer(query, byIntent).slice(0, 6);
  }

  const q = query.toLowerCase();

  if (/\bdeposit\b/.test(q)) {
    const byTitle = rankChunksForAnswer(query, chunks).filter((c) => /\bdeposit\b/i.test(c.title));
    return byTitle.slice(0, 6);
  }

  if (/\b(evict|section 21|section 8|possession)\b/.test(q)) {
    const eviction = rankChunksForAnswer(query, chunks).filter((c) =>
      /\bevict|possession|section 21|section 8/i.test(`${c.title} ${c.chunkText}`),
    );
    if (eviction.length) return eviction.slice(0, 6);
  }

  return rankChunksForAnswer(query, chunks).slice(0, 6);
}

function resolveFallbackSources(
  query: string,
  chunks: RetrievedChunk[],
  intent?: LegalSearchIntent,
): RetrievedChunk[] {
  const filtered = filterChunksForQuery(query, chunks, intent);
  if (filtered.length) return filtered.slice(0, 2);
  if (intent?.requiredTopicTerms.length) return [];
  return pickChunksForFallback(query, chunks, 2);
}

function buildIssuePrompt(intent?: LegalSearchIntent): string {
  if (!intent?.canonicalName) return "";
  const parts = [`ISSUE AREA: ${intent.canonicalName}`];
  if (intent.specificIssue) parts.push(`SPECIFIC ISSUE: ${intent.specificIssue}`);
  parts.push("Only cite sources that relate to this issue area. Ignore unrelated wiki index pages.");
  return parts.join("\n");
}

export type GenerateLegalAnswerResult = {
  answer: string;
  sources: LegalSearchSourceHit[];
  disclaimer: string;
  mode: "synthesis" | "fallback";
};

export async function generateCitationFirstAnswer(
  query: string,
  chunks: RetrievedChunk[],
  confidence: number,
  intent?: LegalSearchIntent,
): Promise<GenerateLegalAnswerResult> {
  const contextChunks = filterChunksForQuery(query, chunks, intent);
  const answerChunks = contextChunks.length ? contextChunks : [];
  const sources = mapSourceHits(answerChunks);
  const disclaimer = LEGAL_SEARCH_DISCLAIMER;
  const qLower = query.toLowerCase();

  if (!chunks.length || (!answerChunks.length && intent && intent.confidence !== "low")) {
    const intentFallback = intentFallbackAnswer(query, intent);
    return {
      answer: sanitizeAdviceText(intentFallback ?? fallbackAnswer(query, chunks, intent)),
      sources: [],
      disclaimer,
      mode: "fallback",
    };
  }

  const effectiveChunks = answerChunks.length ? answerChunks : chunks;

  if (/\bdeposit\b/.test(qLower) && !contextChunks.length && !llmConfigured()) {
    const sourceChunks = resolveFallbackSources(query, chunks, intent);
    const lowNote =
      confidence < 0.38
        ? "\n\nNote: confidence is limited — please check the cited sources carefully."
        : "";
    return {
      answer: sanitizeAdviceText(`${fallbackAnswer(query, chunks, intent)}${lowNote}`),
      sources: mapSourceHits(sourceChunks),
      disclaimer,
      mode: "fallback",
    };
  }

  if (!llmConfigured()) {
    const sourceChunks = resolveFallbackSources(query, effectiveChunks, intent);
    const base = fallbackAnswer(query, effectiveChunks, intent);
    const lowNote =
      confidence < 0.38
        ? "\n\nNote: confidence is limited — please check the cited sources carefully."
        : "";
    return {
      answer: sanitizeAdviceText(`${base}${lowNote}`),
      sources: mapSourceHits(sourceChunks),
      disclaimer,
      mode: "fallback",
    };
  }

  // Vercel serverless: skip slow LLM synthesis unless ENABLE_LLM_ANSWER=true.
  if (!enableLlmAnswer()) {
    const sourceChunks = resolveFallbackSources(query, effectiveChunks, intent);
    const base = fallbackAnswer(query, effectiveChunks, intent);
    return {
      answer: sanitizeAdviceText(base),
      sources: mapSourceHits(sourceChunks),
      disclaimer,
      mode: "fallback",
    };
  }

  try {
    const context = buildSourceContext(effectiveChunks.slice(0, 6));
    const issueBlock = buildIssuePrompt(intent);
    const userPrompt = [
      `USER QUESTION: ${query}`,
      issueBlock,
      `CONFIDENCE: ${confidence.toFixed(2)} (mention if low)`,
      "",
      "SOURCES:",
      context,
    ]
      .filter(Boolean)
      .join("\n");

    const raw = await chat(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      {
        jsonMode: true,
        maxTokens: isHomeOllamaBaseUrl(resolveLlmBaseUrl()) ? 350 : 700,
        temperature: 0.15,
        model: resolveSynthesisModel(),
      },
    );

    let parsed: AnswerJson = {};
    try {
      parsed = JSON.parse(raw) as AnswerJson;
    } catch {
      parsed = { answer: raw };
    }

    let answer = (parsed.answer ?? "").trim();
    if (!answer) answer = fallbackAnswer(query, effectiveChunks, intent);
    answer = sanitizeAdviceText(answer);

    if (confidence < 0.38 && !/confidence|not sure|may not/i.test(answer)) {
      answer = `${answer}\n\nNote: confidence is limited — please check the cited sources carefully.`;
    }

    const used = new Set(parsed.usedSourceIndexes ?? effectiveChunks.map((_, i) => i + 1));
    const filteredSources = sources.filter((_, i) => used.has(i + 1));
    return {
      answer,
      sources: filteredSources.length ? filteredSources : sources,
      disclaimer,
      mode: "synthesis",
    };
  } catch (err) {
    console.warn("[legal-knowledge.generate-answer] LLM failed:", err);
    const sourceChunks = resolveFallbackSources(query, effectiveChunks, intent);
    return {
      answer: sanitizeAdviceText(fallbackAnswer(query, effectiveChunks, intent)),
      sources: mapSourceHits(sourceChunks),
      disclaimer,
      mode: "fallback",
    };
  }
}
