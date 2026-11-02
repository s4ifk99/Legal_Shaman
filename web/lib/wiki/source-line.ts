/**
 * Wiki `sources` lines look like
 *   **Lawhive** — [Illegal Evictions Guide](https://lawhive.co.uk/…) — `raw/lawhive/….md`
 * The `raw/…` path is an internal crawl file and must never reach the user;
 * the markdown link holds the publisher's original URL.
 */

// Link labels can contain one level of brackets, e.g. "What To Expect [2023]".
const MD_LINK_RE = /\[((?:[^[\]]|\[[^[\]]*\])+)\]\((https?:\/\/[^)\s]+)\)/;
const MD_LINK_G = new RegExp(MD_LINK_RE.source, "g");
const RAW_PATH_G = /\s*[—–-]?\s*(?:`raw\/[^`]*`?|(?<=^|\s)raw\/\S+)/g;

export type SourceLine = { title: string; url: string };

export function stripRawSourcePath(text: string): string {
  return String(text || "")
    .replace(RAW_PATH_G, "")
    .replace(/\s*[—–-]\s*$/, "")
    .trim();
}

export function parseSourceLine(raw: string): SourceLine {
  let text = stripRawSourcePath(String(raw || "").replace(/^\s*[-*•]\s+/, ""));
  let url = text.match(MD_LINK_RE)?.[2] ?? "";
  text = text
    .replace(MD_LINK_G, "$1")
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`/g, "");
  if (!url) {
    const bare = text.match(/https?:\/\/[^\s)]+/);
    if (bare) {
      url = bare[0];
      text = text.replace(bare[0], "");
    }
  }
  const title = text
    .replace(/\s+/g, " ")
    .replace(/^\s*[—–:-]\s*|\s*[—–:-]\s*$/g, "")
    .trim();
  return { title, url };
}
