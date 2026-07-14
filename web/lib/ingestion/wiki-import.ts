import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import type { PrismaClient } from "@prisma/client";

import { chunkLegalText } from "@/lib/legal-knowledge/chunker";
import { loadWikiSourceConfig } from "@/lib/wiki/load-config";
import { parseWikiPage } from "@/lib/wiki/parse-page";
import {
  wikiPagePublicUrl,
  wikiPageSlugFromRelativePath,
} from "@/lib/wiki/public-url";

const WIKI_DOMAIN = "wiki.legalshaman";

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

function isQuarantined(relativePath: string): boolean {
  const path = relativePath.toLowerCase();
  return path.includes("_quarantine") || path.includes("/firms/_quarantine/");
}

function wikiUrlForPage(relativePath: string): string {
  return wikiPagePublicUrl(wikiPageSlugFromRelativePath(relativePath));
}

export type WikiImportResult = {
  documentsProcessed: number;
  chunksCreated: number;
  errors: string[];
};

export async function importWikiMarkdown(
  prisma: PrismaClient,
  sourceId: string,
  options?: { limit?: number },
): Promise<WikiImportResult> {
  const config = loadWikiSourceConfig();
  const wikiPagesDir = resolve(config.wikiPagesDir);
  if (!statSync(wikiPagesDir).isDirectory()) {
    throw new Error(`Wiki pages directory not found: ${wikiPagesDir}`);
  }

  const markdownFiles = collectMarkdownFiles(wikiPagesDir)
    .filter((f) => !isQuarantined(relative(wikiPagesDir, f)))
    .sort();

  const limit = options?.limit ?? markdownFiles.length;
  const files = markdownFiles.slice(0, limit);

  let documentsProcessed = 0;
  let chunksCreated = 0;
  const errors: string[] = [];

  for (const filePath of files) {
    try {
      const content = readFileSync(filePath, "utf8");
      const page = parseWikiPage(filePath, wikiPagesDir, content);
      if (isQuarantined(page.relativePath)) continue;

      const sourceUrl = wikiUrlForPage(page.relativePath);
      const cleanText = page.content.trim();
      if (cleanText.length < 80) continue;

      const doc = await prisma.legalDocument.upsert({
        where: { sourceUrl },
        create: {
          sourceId,
          sourceUrl,
          title: page.title,
          domain: WIKI_DOMAIN,
          rawText: content,
          cleanText,
          markdown: content,
          fetchedAt: new Date(),
        },
        update: {
          title: page.title,
          rawText: content,
          cleanText,
          markdown: content,
          fetchedAt: new Date(),
        },
      });

      await prisma.legalChunk.deleteMany({ where: { documentId: doc.id } });

      const chunks = chunkLegalText(cleanText, page.title);
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]!;
        await prisma.legalChunk.create({
          data: {
            documentId: doc.id,
            sourceUrl,
            title: page.title,
            heading: chunk.heading,
            chunkText: chunk.text,
            chunkIndex: i,
            tokenCount: chunk.tokenCount,
            fetchedAt: doc.fetchedAt,
          },
        });
        chunksCreated += 1;
      }

      documentsProcessed += 1;
    } catch (err) {
      errors.push(`${filePath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { documentsProcessed, chunksCreated, errors };
}
