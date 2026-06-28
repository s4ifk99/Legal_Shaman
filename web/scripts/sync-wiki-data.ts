/**
 * Copy wiki-adjacent data from legal_shaman into Signpost/web/data for deploy.
 *
 * Usage: npm run sync:wiki-data
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { loadWikiSourceConfig } from "../lib/wiki/load-config";

const WEB_DATA = resolve(process.cwd(), "data");

function copyIfExists(source: string, dest: string): boolean {
  if (!existsSync(source)) {
    console.warn(`[sync-wiki-data] skip missing: ${source}`);
    return false;
  }
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(source, dest);
  console.info(`[sync-wiki-data] copied ${source} -> ${dest}`);
  return true;
}

function main() {
  const config = loadWikiSourceConfig();
  const wikiRoot = resolve(config.wikiRoot);

  const copies: Array<{ source: string; dest: string }> = [
    {
      source: resolve(wikiRoot, "data/firm-topic-recommendations.json"),
      dest: resolve(WEB_DATA, "firm-topic-recommendations.json"),
    },
  ];

  let copied = 0;
  for (const row of copies) {
    if (copyIfExists(row.source, row.dest)) copied += 1;
  }

  if (!copied) {
    console.error(
      "[sync-wiki-data] No files copied. Run `python3 scripts/firm_recommendations.py` in legal_shaman first.",
    );
    process.exit(1);
  }
}

main();
