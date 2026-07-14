import { chat, llmConfigured } from "@/lib/llm/client";

import type { ExtractedSource } from "./types";

const EXTRACT_PROMPT = `You extract structured legal information signposting from UK source text.
Output valid JSON only:
{
  "claims": [
    { "claimText": "...", "sectionTarget": "Summary|Key Information|Practical Guidance|Sources", "conceptHint": "...", "taxonomySlug": "employment|housing|..." }
  ],
  "concepts": [{ "title": "...", "taxonomySlug": "..." }],
  "organisations": ["ACAS", "Shelter"],
  "sources": ["https://..."]
}
Rules:
- claims must be factual signposting, not legal advice
- sectionTarget maps to wiki template sections
- UK England and Wales context only`;

export async function extractSourceClaims(
  rawText: string,
  sourceUrl?: string,
): Promise<ExtractedSource> {
  const trimmed = rawText.trim().slice(0, 12000);
  if (!trimmed) {
    return { claims: [], concepts: [], organisations: [], sources: sourceUrl ? [sourceUrl] : [] };
  }

  if (!llmConfigured()) {
    return heuristicExtract(trimmed, sourceUrl);
  }

  try {
    const response = await chat(
      [
        { role: "system", content: EXTRACT_PROMPT },
        {
          role: "user",
          content: `Source URL: ${sourceUrl ?? "unknown"}\n\n${trimmed}`,
        },
      ],
      { temperature: 0.1, maxTokens: 2000 },
    );
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return heuristicExtract(trimmed, sourceUrl);
    const parsed = JSON.parse(jsonMatch[0]) as ExtractedSource;
    return {
      claims: parsed.claims ?? [],
      concepts: parsed.concepts ?? [],
      organisations: parsed.organisations ?? [],
      sources: [...(parsed.sources ?? []), ...(sourceUrl ? [sourceUrl] : [])],
    };
  } catch {
    return heuristicExtract(trimmed, sourceUrl);
  }
}

function heuristicExtract(text: string, sourceUrl?: string): ExtractedSource {
  const lines = text
    .split(/\n+/)
    .map((l) => l.replace(/^[-*#>\s]+/, "").trim())
    .filter((l) => l.length >= 20 && l.length < 500);

  return {
    claims: lines.slice(0, 8).map((claimText) => ({
      claimText,
      sectionTarget: "Key Information" as const,
    })),
    concepts: [],
    organisations: [],
    sources: sourceUrl ? [sourceUrl] : [],
  };
}
