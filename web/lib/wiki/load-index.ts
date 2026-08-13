import "server-only";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { WikiIndex } from "./types";

let cached: WikiIndex | null = null;

function wikiIndexPath(): string {
  return (
    process.env.LEGAL_SHAMAN_WIKI_INDEX?.trim() ||
    join(process.cwd(), "data", "wiki-index.json")
  );
}

/**
 * Read-only snapshot of the Obsidian wiki index for /api/ask and search.
 * Loaded from disk (not a static JSON import) so admin/cron functions are not
 * forced over Vercel's 250mb uncompressed limit by the ~96mb wiki file.
 */
export function getWikiIndex(): WikiIndex {
  if (cached) return cached;
  const raw = readFileSync(wikiIndexPath(), "utf8");
  cached = JSON.parse(raw) as WikiIndex;
  return cached;
}
