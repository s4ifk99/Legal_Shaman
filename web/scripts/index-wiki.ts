/**
 * Build a read-only website-side index from the external Obsidian wiki.
 * Does not modify the wiki, raw, or logs directories.
 *
 * Usage: npm run index:wiki
 */
import { buildWikiIndex } from "../lib/wiki/build-index";

function main() {
  const { outputPath, pageCount } = buildWikiIndex();

  console.info(
    JSON.stringify({
      event: "wiki_index_built",
      output: outputPath,
      pageCount,
    }),
  );
}

main();
