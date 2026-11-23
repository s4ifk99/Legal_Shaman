/**
 * Client-safe who-helps freeHelp cache surface.
 * Disk lookup lives in whoHelpsFreeHelpCache.node.ts (scripts / server-only imports).
 * Browser path falls through to match_free_help.
 */
import type { FreeServiceHit } from "@/lib/coherence/matchFreeServices";

export type WhoHelpsFreeHelpCacheEntry = {
  queryKeys: string[];
  title: string;
  wikiId: string;
  liveUrl: string;
  freeHelp: FreeServiceHit[];
  publishedAt: string;
  stage?: "draft" | "published";
};

export function lookupWhoHelpsFreeHelpCache(
  _query: string,
): WhoHelpsFreeHelpCacheEntry | null {
  return null;
}

export function writeWhoHelpsFreeHelpCache(
  _entry: WhoHelpsFreeHelpCacheEntry,
): string {
  throw new Error(
    "writeWhoHelpsFreeHelpCache is Node-only — import from whoHelpsFreeHelpCache.node",
  );
}
