import "server-only";

import { chat, llmConfigured } from "@/lib/llm/client";
import { sanitizeAdviceText } from "@/lib/guardrails/validator";

import { buildSnippet } from "./chunker";
import {
  cleanChunkForProse,
  pickChunksForFallback,
  rankChunksForAnswer,
} from "./clean-prose";
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

function fallbackAnswer(query: string, chunks: RetrievedChunk[]): string {
  if (!chunks.length) {
    return "I could not find enough curated UK legal guidance to answer this confidently.\n\nTry rephrasing your question or use the directory results below to find regulated help.";
  }

  const picked = pickChunksForFallback(query, chunks, 2);
  const q = query.toLowerCase();
  const paragraphs: string[] = [];

  if (!picked.length && /\bdeposit\b/.test(q)) {
    paragraphs.push(
      "When a private landlord holds a tenancy deposit, the money must usually be protected in an approved scheme and returned at the end of the tenancy unless lawful deductions apply. Citizens Advice and Shelter publish free guidance on deposit disputes if you need more detail.",
    );
    paragraphs.push(
      "These points are general signposting only — not legal advice. Citizens Advice and Shelter publish free housing guidance; the directory lists regulated solicitors if you need personal help.",
    );
    return paragraphs.join("\n\n");
  }

  if (!picked.length) {
    return "I could not find enough curated UK legal guidance to answer this confidently.\n\nTry rephrasing your question or use the directory results below to find regulated help.";
  }

  if (/\bdeposit\b/.test(q)) {
    const detail = cleanChunkForProse(picked[0]!.chunkText, 2);
    const onTopic =
      /\bdeposit\b/i.test(picked[0]!.title) ||
      (detail && /\bdeposit\b/i.test(detail));

    if (onTopic && detail) {
      paragraphs.push(
        `When a private landlord holds a tenancy deposit, the returned amount and timing are governed by tenancy deposit protection rules. ${detail} [1].`,
      );
    } else {
      paragraphs.push(
        "When a private landlord holds a tenancy deposit, the money must usually be protected in an approved scheme and returned at the end of the tenancy unless lawful deductions apply. Citizens Advice and Shelter publish free guidance on deposit disputes if you need more detail.",
      );
    }
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

  paragraphs.push(
    picked.length
      ? "These points come only from the cited pages below — not legal advice. Citizens Advice and Shelter publish free housing guidance; the directory lists regulated solicitors if you need personal help."
      : "This is general signposting only — not legal advice. Citizens Advice and Shelter publish free housing guidance; the directory lists regulated solicitors if you need personal help.",
  );

  return paragraphs.join("\n\n");
}

function mapSourceHits(chunks: RetrievedChunk[]): LegalSearchSourceHit[] {
  return chunks.map((c) => ({
    title: c.heading ? `${c.title} — ${c.heading}` : c.title,
    url: c.sourceUrl,
    source: c.sourceName,
    snippet: c.snippet,
    score: Number(c.finalScore.toFixed(4)),
    heading: c.heading,
  }));
}

/** Keep cited sources aligned with the user's issue — avoid harassment/eviction pages on deposit queries. */
export function filterChunksForQuery(query: string, chunks: RetrievedChunk[]): RetrievedChunk[] {
  const q = query.toLowerCase();
  if (!chunks.length) return chunks;

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

function resolveFallbackSources(query: string, chunks: RetrievedChunk[]): RetrievedChunk[] {
  const filtered = filterChunksForQuery(query, chunks);
  if (filtered.length) return filtered.slice(0, 2);
  return pickChunksForFallback(query, chunks, 2);
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
): Promise<GenerateLegalAnswerResult> {
  const contextChunks = filterChunksForQuery(query, chunks);
  const answerChunks = contextChunks.length ? contextChunks : chunks;
  const sources = mapSourceHits(answerChunks);
  const disclaimer = LEGAL_SEARCH_DISCLAIMER;
  const qLower = query.toLowerCase();

  if (!chunks.length) {
    return {
      answer: fallbackAnswer(query, chunks),
      sources,
      disclaimer,
      mode: "fallback",
    };
  }

  if (/\bdeposit\b/.test(qLower) && !contextChunks.length) {
    const sourceChunks = resolveFallbackSources(query, chunks);
    const lowNote =
      confidence < 0.38
        ? "\n\nNote: confidence is limited — please check the cited sources carefully."
        : "";
    return {
      answer: sanitizeAdviceText(`${fallbackAnswer(query, chunks)}${lowNote}`),
      sources: mapSourceHits(sourceChunks),
      disclaimer,
      mode: "fallback",
    };
  }

  if (!llmConfigured()) {
    const sourceChunks = resolveFallbackSources(query, chunks);
    const base = fallbackAnswer(query, chunks);
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

  try {
    const context = buildSourceContext(answerChunks.slice(0, 6));
    const userPrompt = [
      `USER QUESTION: ${query}`,
      `CONFIDENCE: ${confidence.toFixed(2)} (mention if low)`,
      "",
      "SOURCES:",
      context,
    ].join("\n");

    const raw = await chat(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      { jsonMode: true, maxTokens: 700, temperature: 0.15 },
    );

    let parsed: AnswerJson = {};
    try {
      parsed = JSON.parse(raw) as AnswerJson;
    } catch {
      parsed = { answer: raw };
    }

    let answer = (parsed.answer ?? "").trim();
    if (!answer) answer = fallbackAnswer(query, answerChunks);
    answer = sanitizeAdviceText(answer);

    if (confidence < 0.38 && !/confidence|not sure|may not/i.test(answer)) {
      answer = `${answer}\n\nNote: confidence is limited — please check the cited sources carefully.`;
    }

    const used = new Set(parsed.usedSourceIndexes ?? answerChunks.map((_, i) => i + 1));
    const filteredSources = sources.filter((_, i) => used.has(i + 1));
    return {
      answer,
      sources: filteredSources.length ? filteredSources : sources,
      disclaimer,
      mode: "synthesis",
    };
  } catch (err) {
    console.warn("[legal-knowledge.generate-answer] LLM failed:", err);
    const sourceChunks = resolveFallbackSources(query, chunks);
    return {
      answer: sanitizeAdviceText(fallbackAnswer(query, chunks)),
      sources: mapSourceHits(sourceChunks),
      disclaimer,
      mode: "fallback",
    };
  }
}
