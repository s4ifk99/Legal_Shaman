/**
 * Wiki clawback: find overlapping wiki pages for a title / matter.
 *
 * Usage:
 *   npm run wiki:clawback -- --title "garage repair failed" --matter consumer
 *   npm run wiki:clawback -- --brief data/reddit-daily-brief/2026-09-21.json
 *
 * Prints JSON overlap rows to stdout.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type WikiPageLite = {
  id: string;
  title: string;
  category?: string;
  summary?: string;
};

type ClawHit = {
  id: string;
  title: string;
  score: number;
  publicUrl: string;
  reason: string;
};

const INDEX_PATH = resolve(process.cwd(), "data/wiki-index.json");
const BASE = "https://www.legalshaman.com";

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOP.has(t));
}

const STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "what",
  "when",
  "who",
  "helps",
  "help",
  "your",
  "you",
  "are",
  "was",
  "were",
  "have",
  "has",
  "not",
  "can",
  "how",
  "does",
  "did",
  "into",
  "about",
  "england",
  "wales",
  "scotland",
]);

function loadPages(): WikiPageLite[] {
  if (!existsSync(INDEX_PATH)) {
    throw new Error(`Missing ${INDEX_PATH}`);
  }
  const idx = JSON.parse(readFileSync(INDEX_PATH, "utf8")) as { pages: WikiPageLite[] };
  return idx.pages ?? [];
}

function scoreOverlap(queryTokens: string[], page: WikiPageLite): ClawHit | null {
  const hay = `${page.title} ${page.summary ?? ""} ${page.id}`.toLowerCase();
  let hits = 0;
  const matched: string[] = [];
  for (const t of queryTokens) {
    if (hay.includes(t)) {
      hits += 1;
      matched.push(t);
    }
  }
  if (hits < 2) return null;
  const titleTokens = tokenize(page.title);
  const titleHits = queryTokens.filter((t) => titleTokens.includes(t)).length;
  const score = hits * 2 + titleHits * 3;
  if (score < 6) return null;
  return {
    id: page.id,
    title: page.title,
    score,
    publicUrl: `${BASE}/ask-the-shaman/wiki/${encodeURIComponent(page.id)}`,
    reason: `matched: ${matched.slice(0, 8).join(", ")}`,
  };
}

function clawback(title: string, matter?: string, limit = 5): ClawHit[] {
  const tokens = tokenize(title);
  if (matter) tokens.push(...tokenize(matter));
  const pages = loadPages();
  const hits: ClawHit[] = [];
  for (const page of pages) {
    // Prefer Areas/ editorial pages
    if (!page.id.startsWith("Areas/")) continue;
    const hit = scoreOverlap(tokens, page);
    if (hit) hits.push(hit);
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}

function parseArgs(argv: string[]) {
  const out: { title?: string; matter?: string; brief?: string; limit?: number } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--title") out.title = argv[++i];
    else if (a === "--matter") out.matter = argv[++i];
    else if (a === "--brief") out.brief = argv[++i];
    else if (a === "--limit") out.limit = Number(argv[++i]) || 5;
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.brief) {
    const briefPath = resolve(process.cwd(), args.brief);
    const brief = JSON.parse(readFileSync(briefPath, "utf8")) as {
      picks: Array<{ id: string; title: string; matterGuess?: string }>;
    };
    const rows = brief.picks.map((p) => ({
      demandRef: p.id,
      title: p.title,
      matter: p.matterGuess,
      overlaps: clawback(p.title, p.matterGuess, args.limit ?? 5),
    }));
    console.log(JSON.stringify({ brief: args.brief, rows }, null, 2));
    return;
  }
  if (!args.title) {
    console.error("Usage: wiki:clawback --title \"...\" [--matter consumer] OR --brief path");
    process.exit(2);
  }
  const overlaps = clawback(args.title, args.matter, args.limit ?? 5);
  console.log(
    JSON.stringify(
      {
        title: args.title,
        matter: args.matter ?? null,
        overlapWikiIds: overlaps.map((o) => o.id).join("\n"),
        overlaps,
      },
      null,
      2,
    ),
  );
}

main();
