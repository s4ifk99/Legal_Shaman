export type TextChunk = {
  heading: string | null;
  text: string;
  tokenCount: number;
};

const TARGET_MIN_TOKENS = 500;
const TARGET_MAX_TOKENS = 1000;
const OVERLAP_TOKENS = 120;

/** Rough token estimate — good enough for chunk sizing without tiktoken. */
export function estimateTokens(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words * 1.3));
}

function charsForTokens(tokens: number): number {
  return Math.floor(tokens * 4);
}

type Section = { heading: string | null; body: string };

function splitMarkdownSections(markdown: string): Section[] {
  const lines = markdown.split(/\n/);
  const sections: Section[] = [];
  let currentHeading: string | null = null;
  let buffer: string[] = [];

  function flush() {
    const body = buffer.join("\n").trim();
    if (body) sections.push({ heading: currentHeading, body });
    buffer = [];
  }

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+)$/);
    const h3 = line.match(/^###\s+(.+)$/);
    if (h2 || h3) {
      flush();
      currentHeading = (h2?.[1] ?? h3?.[1] ?? "").trim() || null;
      continue;
    }
    buffer.push(line);
  }
  flush();

  if (!sections.length && markdown.trim()) {
    sections.push({ heading: null, body: markdown.trim() });
  }

  return sections;
}

/** Avoid splitting numbered legal tests / procedural steps mid-list when possible. */
function splitSectionBody(body: string, heading: string | null): string[] {
  const paragraphs = body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const out: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    const isNumberedStep = /^\d+[\).\]]\s/.test(para) || /^Step\s+\d+/i.test(para);
    const candidate = current ? `${current}\n\n${para}` : para;
    const tokens = estimateTokens(candidate);

    if (tokens <= TARGET_MAX_TOKENS) {
      current = candidate;
      continue;
    }

    if (current) {
      out.push(current);
      current = "";
    }

    if (estimateTokens(para) > TARGET_MAX_TOKENS && !isNumberedStep) {
      const sentences = para.split(/(?<=[.!?])\s+/);
      let sentenceBuf = "";
      for (const sentence of sentences) {
        const next = sentenceBuf ? `${sentenceBuf} ${sentence}` : sentence;
        if (estimateTokens(next) > TARGET_MAX_TOKENS && sentenceBuf) {
          out.push(sentenceBuf);
          sentenceBuf = sentence;
        } else {
          sentenceBuf = next;
        }
      }
      if (sentenceBuf) current = sentenceBuf;
    } else {
      current = para;
    }
  }

  if (current) out.push(current);
  if (!out.length && body.trim()) out.push(body.trim());
  return out;
}

function applyOverlap(chunks: TextChunk[]): TextChunk[] {
  if (chunks.length < 2) return chunks;
  const overlapChars = charsForTokens(OVERLAP_TOKENS);
  const withOverlap: TextChunk[] = [chunks[0]!];

  for (let i = 1; i < chunks.length; i++) {
    const prev = chunks[i - 1]!.text;
    const tail = prev.slice(Math.max(0, prev.length - overlapChars)).trim();
    const merged = tail ? `${tail}\n\n${chunks[i]!.text}` : chunks[i]!.text;
    withOverlap.push({
      heading: chunks[i]!.heading,
      text: merged.trim(),
      tokenCount: estimateTokens(merged),
    });
  }

  return withOverlap;
}

/** Split page markdown/plain text into retrieval-oriented chunks. */
export function chunkLegalText(markdown: string, title: string): TextChunk[] {
  const sections = splitMarkdownSections(markdown);
  const rawChunks: TextChunk[] = [];

  for (const section of sections) {
    const parts = splitSectionBody(section.body, section.heading);
    for (const part of parts) {
      const heading = section.heading ?? (part !== section.body ? title : title);
      const text = heading && !part.toLowerCase().startsWith(heading.toLowerCase())
        ? `${heading}\n\n${part}`
        : part;
      const tokenCount = estimateTokens(text);
      if (tokenCount < 40) continue;
      rawChunks.push({ heading: section.heading, text: text.trim(), tokenCount });
    }
  }

  const merged: TextChunk[] = [];
  for (const chunk of rawChunks) {
    const last = merged[merged.length - 1];
    if (last && last.tokenCount < TARGET_MIN_TOKENS && last.tokenCount + chunk.tokenCount <= TARGET_MAX_TOKENS) {
      const text = `${last.text}\n\n${chunk.text}`;
      merged[merged.length - 1] = {
        heading: last.heading ?? chunk.heading,
        text,
        tokenCount: estimateTokens(text),
      };
    } else {
      merged.push(chunk);
    }
  }

  return applyOverlap(merged);
}

export function buildSnippet(text: string, maxLen = 280): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxLen) return cleaned;
  return `${cleaned.slice(0, maxLen - 3)}...`;
}
