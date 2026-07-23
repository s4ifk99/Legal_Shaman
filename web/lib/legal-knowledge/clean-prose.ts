import type { RetrievedChunk } from "./types";

/** Strip Obsidian/wiki/markdown noise into readable user-facing prose. */
export function cleanWikiMarkup(text: string): string {
  if (!text) return "";
  let cleaned = text
    // Obsidian wikilinks: [[Title]] or [[path|Title]]
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_m, path: string, alias?: string) => {
      const label = (alias ?? path).split("/").pop()?.trim() ?? path;
      return label;
    })
    // Markdown links: [label](url)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    // Bare "Source: ..." fragments (often scraped into summaries)
    .replace(/(?:^|\s)Source:\s*[^.!?\n]+[.!?]?/gi, " ")
    // Leaked authoring instructions from wiki pages
    .replace(
      /\bAnswers should cite the source URL and raw file path from each page'?s Sources section\.?/gi,
      "",
    )
    .replace(/\b(raw file path|cite the source URL)\b[^.?!]*[.?!]?/gi, "")
    .replace(/^#+\s+.+$/gm, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();

  cleaned = cleaned
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([.!?])\s*([.!?])+/g, "$1")
    .trim();

  return cleaned;
}

/** Strip wiki/markdown noise and return 1–2 complete sentences for prose answers. */
export function cleanChunkForProse(text: string, maxSentences = 2): string {
  let cleaned = cleanWikiMarkup(text)
    .replace(/^\s*Summary\s*/i, "")
    .replace(/^\s*Key [Ii]nformation\s*/i, "")
    .replace(/^\s*Practical [Gg]uidance\s*/i, "")
    .trim();

  cleaned = cleaned.replace(/^[^A-Za-z0-9]{0,2}[a-z]{0,3}\.\s*/i, "");

  const sentences =
    cleaned.match(/[^.!?]+[.!?]+(?:\s|$)/g)?.map((s) => s.trim()) ??
    (cleaned ? [cleaned] : []);

  const usable = sentences
    .map((s) => s.replace(/^\d+\.\s*/, "").trim())
    .filter((s) => s.length >= 25 && !/^about this guide$/i.test(s))
    .filter((s) => !/\b(cite the source|raw file path|Answers should)\b/i.test(s))
    .map((s) => s.replace(/\.\.+/g, ".").replace(/\s+\./g, "."));

  if (!usable.length) {
    const fallback = cleaned.slice(0, 220).trim();
    return fallback.replace(/\s+\S{0,2}$/, "").trim();
  }

  return usable.slice(0, maxSentences).join(" ");
}

function queryTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length >= 4);
}

function chunkRelevanceScore(query: string, chunk: RetrievedChunk): number {
  const hay = `${chunk.title} ${chunk.heading ?? ""} ${chunk.chunkText}`.toLowerCase();
  const q = query.toLowerCase();
  let score = chunk.finalScore * 10;

  for (const term of queryTerms(query)) {
    if (hay.includes(term)) score += term.length;
  }

  if (/\bdeposit\b/.test(q) && /\bdeposit\b/.test(hay)) score += 30;
  if (/\blandlord\b/.test(q) && /\blandlord\b/.test(hay)) score += 12;
  if (/\btenant\b/.test(q) && /\btenant\b/.test(hay)) score += 8;
  if (/\bevict/.test(q) && /\bevict/.test(hay)) score += 20;
  if (/\bdisrepair|damp|mould\b/.test(q) && /\bdisrepair|damp|mould|repair/.test(hay)) score += 20;

  if (/\bdeposit\b/.test(q)) {
    if (/\bdeposit\b/.test(hay)) score += 40;
    if (!/\bdeposit\b/.test(hay)) score -= 50;
    if (/\b(harassment|illegal eviction)\b/.test(hay) && !/\bdeposit\b/.test(hay)) score -= 25;
  }

  return score;
}

export function rankChunksForAnswer(query: string, chunks: RetrievedChunk[]): RetrievedChunk[] {
  return [...chunks].sort(
    (a, b) => chunkRelevanceScore(query, b) - chunkRelevanceScore(query, a),
  );
}

export function pickChunksForFallback(
  query: string,
  chunks: RetrievedChunk[],
  limit = 2,
): RetrievedChunk[] {
  const ranked = rankChunksForAnswer(query, chunks);
  const q = query.toLowerCase();

  if (/\bdeposit\b/.test(q)) {
    const byTitle = ranked.filter((c) => /\bdeposit\b/i.test(c.title));
    if (byTitle.length) return byTitle.slice(0, limit);
  }

  const picked: RetrievedChunk[] = [];

  for (const chunk of ranked) {
    if (picked.length >= limit) break;
    const prose = cleanChunkForProse(chunk.chunkText, 1);
    if (prose.length < 30) continue;

    const hay = `${chunk.title} ${prose}`.toLowerCase();

    if (/\bdeposit\b/.test(q)) {
      if (!/\bdeposit\b/i.test(chunk.title)) continue;
    } else if (/\blandlord\b/.test(q) && !/\b(tenant|tenancy|rent|deposit|evict|repair)\b/.test(q)) {
      if (!/\b(landlord|tenant|tenancy)\b/.test(hay)) continue;
    }

    picked.push(chunk);
  }

  if (!picked.length && /\bdeposit\b/.test(q)) return [];

  return picked.length ? picked : ranked.slice(0, Math.min(limit, ranked.length));
}
