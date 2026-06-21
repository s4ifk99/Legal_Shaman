/**
 * Build a read-only website-side index from the external Obsidian wiki.
 * Does not modify the wiki, raw, or logs directories.
 *
 * Usage: npm run index:wiki
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { loadWikiSourceConfig } from "../lib/wiki/load-config";
import { parseWikiPage } from "../lib/wiki/parse-page";
import type { WikiIndex, WikiPageIndex } from "../lib/wiki/types";

const OUTPUT = resolve(process.cwd(), "data/wiki-index.json");

function collectMarkdownFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectMarkdownFiles(fullPath));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      files.push(fullPath);
    }
  }
  return files;
}

function main() {
  const config = loadWikiSourceConfig();
  const wikiPagesDir = resolve(config.wikiPagesDir);

  if (!statSync(wikiPagesDir).isDirectory()) {
    console.error(`Wiki pages directory not found: ${wikiPagesDir}`);
    process.exit(1);
  }

  const markdownFiles = collectMarkdownFiles(wikiPagesDir).sort();
  const pages: WikiPageIndex[] = [];

  for (const filePath of markdownFiles) {
    const content = readFileSync(filePath, "utf8");
    pages.push(parseWikiPage(filePath, wikiPagesDir, content));
  }

  const payload: WikiIndex = {
    meta: {
      indexedAt: new Date().toISOString(),
      pageCount: pages.length,
      wikiRoot: config.wikiRoot,
      wikiPagesDir: config.wikiPagesDir,
    },
    pages,
  };

  writeFileSync(OUTPUT, `${JSON.stringify(payload)}\n`, "utf8");

  console.info(
    JSON.stringify({
      event: "wiki_index_built",
      output: OUTPUT,
      pageCount: pages.length,
      categories: [...new Set(pages.map((p) => p.category))].sort(),
    }),
  );
}

main();
