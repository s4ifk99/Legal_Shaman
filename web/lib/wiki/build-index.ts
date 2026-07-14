import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { loadWikiSourceConfig } from "./load-config";
import { parseWikiPage } from "./parse-page";
import type { WikiIndex, WikiPageIndex } from "./types";

function collectMarkdownFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name === "_quarantine") {
      continue;
    }
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectMarkdownFiles(fullPath));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      if (entry.name === "_index.md") {
        continue;
      }
      files.push(fullPath);
    }
  }
  return files;
}

export type BuildWikiIndexResult = {
  outputPath: string;
  pageCount: number;
  pages: WikiPageIndex[];
};

/** Build wiki-index.json from the Obsidian vault (read-only; does not modify wiki files). */
export function buildWikiIndex(outputPath?: string): BuildWikiIndexResult {
  const config = loadWikiSourceConfig();
  const wikiPagesDir = resolve(config.wikiPagesDir);
  const output = outputPath ?? resolve(process.cwd(), "data/wiki-index.json");

  if (!statSync(wikiPagesDir).isDirectory()) {
    throw new Error(`Wiki pages directory not found: ${wikiPagesDir}`);
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

  writeFileSync(output, `${JSON.stringify(payload)}\n`, "utf8");

  return { outputPath: output, pageCount: pages.length, pages };
}
