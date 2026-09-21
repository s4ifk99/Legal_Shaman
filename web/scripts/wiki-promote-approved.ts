/**
 * Promote one Approved Blog Queue draft into the wiki vault + index.
 *
 * This is a helper for the publish Cursor Automation. It does NOT talk to Notion;
 * pass the drafted markdown and metadata via CLI / env / JSON file.
 *
 * Usage:
 *   npm run wiki:promote-approved -- --input /tmp/promote.json
 *
 * promote.json shape:
 * {
 *   "title": "Private parking charge for a short hospital stay: who helps",
 *   "wikiRelativeDir": "Areas/Driving and Parking/Parking and PCNs",
 *   "markdown": "# Title?\n\n## Summary\n...\n",
 *   "overlapWikiIds": ["Areas/.../other page"],
 *   "pinSitemap": true
 * }
 *
 * Writes vault .md, upserts wiki-index.json, optionally patches sitemap.ts priorityIds,
 * and appends Related Concepts links on overlap targets when those vault files exist.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

type WikiPageIndex = {
  id: string;
  title: string;
  filePath: string;
  relativePath: string;
  category: string;
  summary: string;
  keyInformation: string[];
  practicalGuidance: string[];
  relatedConcepts: string[];
  relatedOrganisations: string[];
  sources: string[];
  content: string;
};

const WIKI_ROOT =
  process.env.WIKI_PAGES_DIR?.trim() ||
  resolve(process.cwd(), "../../Knowledge/wiki");
const INDEX_PATH = resolve(process.cwd(), "data/wiki-index.json");
const SITEMAP_PATH = resolve(process.cwd(), "app/sitemap.ts");
const BASE = "https://www.legalshaman.com";

type PromoteInput = {
  title: string;
  wikiRelativeDir: string;
  markdown: string;
  overlapWikiIds?: string[];
  pinSitemap?: boolean;
};

function parseArgs(argv: string[]) {
  let inputPath: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--input") inputPath = argv[++i];
  }
  if (!inputPath) {
    throw new Error("Required: --input path/to/promote.json");
  }
  return resolve(process.cwd(), inputPath);
}

function parseWikiPageLocal(absolutePath: string, content: string): WikiPageIndex {
  const relativePath = absolutePath
    .replace(WIKI_ROOT.replace(/\\/g, "/") + "/", "")
    .replace(/\\/g, "/");
  const parts = relativePath.split("/");
  let category = parts[0] ?? "wiki";
  if (category === "Areas" && parts.length > 1) category = parts[1] ?? "Areas";

  const titleMatch = content.match(/^#\s+(.+?)\s*$/m);
  const title = titleMatch?.[1]?.trim() || basename(absolutePath, ".md");

  const sections = new Map<string, string>();
  const chunks = content.split(/^##\s+/m);
  for (const part of chunks.slice(1)) {
    const nl = part.indexOf("\n");
    if (nl === -1) sections.set(part.trim(), "");
    else sections.set(part.slice(0, nl).trim(), part.slice(nl + 1).trim());
  }

  const bullets = (name: string) => {
    for (const [h, body] of Array.from(sections.entries())) {
      if (h.toLowerCase() === name.toLowerCase()) {
        return body
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l.startsWith("- "))
          .map((l) => l.replace(/^-\s+/, "").trim());
      }
    }
    return [] as string[];
  };

  const text = (name: string) => {
    for (const [h, body] of Array.from(sections.entries())) {
      if (h.toLowerCase() === name.toLowerCase()) {
        return body.replace(/\n+/g, " ").trim();
      }
    }
    return "";
  };

  const links = (name: string) => {
    const out: string[] = [];
    for (const line of bullets(name)) {
      const wl = Array.from(line.matchAll(/\[\[([^\]]+)\]\]/g)).map((m) => m[1]!.trim());
      if (wl.length) out.push(...wl);
      else out.push(line);
    }
    return Array.from(new Set(out));
  };

  return {
    id: relativePath.replace(/\.md$/i, ""),
    title,
    filePath: absolutePath,
    relativePath,
    category,
    summary: text("Summary"),
    keyInformation: bullets("Key Information"),
    practicalGuidance: bullets("Practical Guidance"),
    relatedConcepts: links("Related Concepts"),
    relatedOrganisations: links("Related Organisations"),
    sources: bullets("Sources"),
    content,
  };
}

function ensureRelatedLink(md: string, label: string): string {
  const needle = `[[${label}]]`;
  if (md.includes(needle)) return md;
  if (/## Related Concepts\n/i.test(md)) {
    return md.replace(
      /(## Related Concepts\n(?:.*\n)*?)(\n## |\n*$)/i,
      (_m, a: string, b: string) => {
        if (a.includes(needle)) return a + b;
        return `${a.trimEnd()}\n- ${needle}\n${b}`;
      },
    );
  }
  return `${md.trimEnd()}\n\n## Related Concepts\n\n- ${needle}\n`;
}

function pinSitemap(wikiId: string) {
  if (!existsSync(SITEMAP_PATH)) return;
  let src = readFileSync(SITEMAP_PATH, "utf8");
  if (src.includes(JSON.stringify(wikiId)) || src.includes(`"${wikiId}"`)) return;
  src = src.replace(
    /(const priorityIds = new Set\(\[\n)([\s\S]*?)(\n\s*\]\);)/,
    (_m, open: string, body: string, close: string) => {
      const indent = "      ";
      return `${open}${body.trimEnd()}\n${indent}${JSON.stringify(wikiId)},${close}`;
    },
  );
  writeFileSync(SITEMAP_PATH, src, "utf8");
}

function main() {
  const inputPath = parseArgs(process.argv.slice(2));
  const input = JSON.parse(readFileSync(inputPath, "utf8")) as PromoteInput;
  if (!input.title?.trim() || !input.wikiRelativeDir?.trim() || !input.markdown?.trim()) {
    throw new Error("promote.json needs title, wikiRelativeDir, markdown");
  }

  const stem = input.title.replace(/\?+$/, "").trim();
  const relDir = input.wikiRelativeDir.replace(/^\/+|\/+$/g, "");
  const relativePath = `${relDir}/${stem}.md`;
  const absolutePath = resolve(WIKI_ROOT, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });

  let markdown = input.markdown.trim();
  if (!markdown.startsWith("#")) {
    markdown = `# ${stem}?\n\n${markdown}`;
  }

  // Ensure overlap siblings appear in Related Concepts
  for (const overlapId of input.overlapWikiIds ?? []) {
    const label = overlapId.split("/").pop() || overlapId;
    markdown = ensureRelatedLink(markdown, label);
  }

  writeFileSync(absolutePath, markdown.endsWith("\n") ? markdown : markdown + "\n", "utf8");

  const entry = parseWikiPageLocal(absolutePath, readFileSync(absolutePath, "utf8"));
  const idx = JSON.parse(readFileSync(INDEX_PATH, "utf8")) as { pages: WikiPageIndex[] };
  const pages = idx.pages ?? [];
  const existing = pages.findIndex((p) => p.id === entry.id);
  if (existing >= 0) pages[existing] = entry;
  else pages.unshift(entry);
  idx.pages = pages;
  writeFileSync(INDEX_PATH, JSON.stringify(idx), "utf8");

  // Bidirectional: add this page's title stem into overlap vault files
  const linkLabel = stem;
  for (const overlapId of input.overlapWikiIds ?? []) {
    const overlapPath = resolve(WIKI_ROOT, `${overlapId}.md`);
    if (!existsSync(overlapPath)) continue;
    let other = readFileSync(overlapPath, "utf8");
    other = ensureRelatedLink(other, linkLabel);
    writeFileSync(overlapPath, other.endsWith("\n") ? other : other + "\n", "utf8");
    const otherEntry = parseWikiPageLocal(overlapPath, other);
    const oi = pages.findIndex((p) => p.id === otherEntry.id);
    if (oi >= 0) pages[oi] = otherEntry;
  }
  idx.pages = pages;
  writeFileSync(INDEX_PATH, JSON.stringify(idx), "utf8");

  if (input.pinSitemap !== false) pinSitemap(entry.id);

  const liveUrl = `${BASE}/ask-the-shaman/wiki/${encodeURIComponent(entry.id)}`;
  console.log(
    JSON.stringify({
      event: "wiki_promote_done",
      wikiId: entry.id,
      liveUrl,
      filePath: absolutePath,
      overlapCount: input.overlapWikiIds?.length ?? 0,
    }),
  );
}

main();
