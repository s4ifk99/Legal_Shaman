/**
 * One off (safe to re-run): rewrite wiki links written with %2F in place of
 * folder slashes to the canonical slash form, in wiki-index.json, the vault
 * markdown and local blog drafts.
 *
 * Usage: npx tsx scripts/fix-wiki-encoded-slash-links.ts [--dry-run]
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { normalizeWikiLinksInText } from "../lib/wiki/public-url";

const dryRun = process.argv.includes("--dry-run");
const INDEX_PATH = resolve(process.cwd(), "data/wiki-index.json");
const WIKI_ROOT = process.env.WIKI_PAGES_DIR?.trim() || resolve(process.cwd(), "../../Knowledge/wiki");
const DRAFTS = resolve(process.cwd(), "data/blog-drafts");

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".md") || name.endsWith(".json")) out.push(p);
  }
  return out;
}

type Page = Record<string, unknown> & { id: string };
const fix = (v: unknown): unknown =>
  typeof v === "string" ? normalizeWikiLinksInText(v) : Array.isArray(v) ? v.map(fix) : v;

let pagesChanged = 0;
const idx = JSON.parse(readFileSync(INDEX_PATH, "utf8")) as { pages: Page[] };
idx.pages = idx.pages.map((page) => {
  const before = JSON.stringify(page);
  const next: Page = { ...page };
  for (const key of ["content", "summary", "keyInformation", "practicalGuidance", "sources", "relatedOrganisations", "relatedConcepts"]) {
    if (key in next) next[key] = fix(next[key]);
  }
  if (JSON.stringify(next) !== before) pagesChanged++;
  return next;
});
if (!dryRun && pagesChanged) writeFileSync(INDEX_PATH, JSON.stringify(idx), "utf8");

let filesChanged = 0;
for (const file of [...walk(WIKI_ROOT).filter((f) => f.endsWith(".md")), ...walk(DRAFTS)]) {
  const src = readFileSync(file, "utf8");
  const out = normalizeWikiLinksInText(src);
  if (out !== src) {
    filesChanged++;
    if (!dryRun) writeFileSync(file, out, "utf8");
  }
}

const remaining = JSON.stringify(idx).match(/ask-the-shaman\/wiki\/[^\s)"]*%2F/gi)?.length ?? 0;
console.log(JSON.stringify({ event: "fix_wiki_encoded_slash_links", dryRun, pagesChanged, filesChanged, remainingInIndex: remaining }));
