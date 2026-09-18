import type { ReactNode } from "react";

const TOKEN =
  /(\[\[([^\]]+)\]\]|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\*\*([^*]+)\*\*|`([^`]+)`)/g;

/**
 * Render lightweight wiki/markdown inline marks for public wiki pages:
 * `[label](url)`, `[[wikilink]]`, and `` `code` ``.
 * `**bold**` is stripped to plain text (no weight change).
 * Also strips a leftover leading list marker if the index left one on.
 */
export function renderWikiInline(raw: string): ReactNode {
  const text = raw.replace(/^\s*[-*•]\s+/, "").trim();
  if (!text) return null;

  const nodes: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  TOKEN.lastIndex = 0;

  while ((match = TOKEN.exec(text)) !== null) {
    if (match.index > last) {
      nodes.push(text.slice(last, match.index));
    }

    if (match[2]) {
      // [[wikilink]] → plain label
      nodes.push(match[2]);
    } else if (match[3] && match[4]) {
      nodes.push(
        <a
          key={key++}
          href={match[4]}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-gold underline underline-offset-2 hover:text-foreground"
        >
          {match[3]}
        </a>,
      );
    } else if (match[5]) {
      // **bold** → plain text (unbold)
      nodes.push(match[5]);
    } else if (match[6]) {
      nodes.push(
        <code key={key++} className="rounded bg-muted px-1 py-0.5 text-[0.85em]">
          {match[6]}
        </code>,
      );
    }

    last = match.index + match[0].length;
  }

  if (last < text.length) {
    nodes.push(text.slice(last));
  }

  return nodes.length === 1 ? nodes[0] : nodes;
}
