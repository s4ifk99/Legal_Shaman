import wikiIndexRaw from "@/data/wiki-index.json";
import type { WikiIndex } from "./types";

/** Read-only snapshot of the Obsidian wiki index for /api/ask and search. */
export function getWikiIndex(): WikiIndex {
  return wikiIndexRaw as WikiIndex;
}
