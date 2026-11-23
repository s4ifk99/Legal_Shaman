#!/usr/bin/env tsx
/**
 * Match free doors for who-helps drafts (offline product test).
 *
 * Usage:
 *   npm run blog:match-free -- --title "Gym kept charging after I cancelled" --matter consumer
 *   npm run blog:match-free -- --date 2026-11-09
 *   npm run blog:match-free -- --date 2026-11-09 --seed
 *   npm run blog:match-free -- --date 2026-11-09 --file 01-gym-auto-renew-after-cancel-who-helps.md --seed
 *
 * --date runs also warm data/coherence/who-helps-freehelp-cache for matchOk drafts
 * (pass --no-cache to skip).
 */
import fs from "node:fs";
import path from "node:path";
import {
  anonymisedQueryFromDraft,
  matchFileStem,
  matchFreeDoorsForSituation,
  writeMatchSnapshot,
  type BlogFreeHelpMatch,
} from "../lib/blog-drafts/match-free";
import { seedDraftBodyFromMatch } from "../lib/blog-drafts/seed-from-matches";
import { listLocalDrafts } from "../lib/blog-drafts/local-queue";
import { writeWhoHelpsFreeHelpCache } from "../lib/coherence/whoHelpsFreeHelpCache.node";

/**
 * Warm the who-helps freeHelp cache at draft time, strong matches only, so the
 * live matcher (resolveFreeHelp) serves these situations from disk with no
 * API spend. wiki:promote-local-approved later fills in wikiId / liveUrl.
 */
function warmCacheForStrongMatch(
  title: string,
  story: string,
  match: BlogFreeHelpMatch,
): boolean {
  if (!match.matchOk || !match.freeHelp.length) return false;
  writeWhoHelpsFreeHelpCache({
    queryKeys: [title, title.replace(/[?:]\s*who helps\??$/i, ""), match.query, story].filter(
      (s): s is string => Boolean(s && s.trim()),
    ),
    title: title.replace(/\?$/, ""),
    wikiId: "",
    liveUrl: "",
    freeHelp: match.freeHelp,
    publishedAt: new Date().toISOString(),
    stage: "draft",
  });
  return true;
}

function parseArgs(argv: string[]) {
  let title: string | undefined;
  let matter: string | undefined;
  let story: string | undefined;
  let date: string | undefined;
  let file: string | undefined;
  let seed = false;
  let noCache = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--title") title = argv[++i];
    else if (a === "--matter") matter = argv[++i];
    else if (a === "--story") story = argv[++i];
    else if (a === "--date") date = argv[++i];
    else if (a === "--file") file = argv[++i];
    else if (a === "--seed") seed = true;
    else if (a === "--no-cache") noCache = true;
  }
  return { title, matter, story, date, file, seed, noCache };
}

function updateIndexMatchMeta(
  date: string,
  draftFile: string,
  match: BlogFreeHelpMatch,
) {
  const indexPath = path.join(process.cwd(), "data", "blog-drafts", date, "index.json");
  const batch = JSON.parse(fs.readFileSync(indexPath, "utf8")) as {
    drafts: Array<Record<string, unknown>>;
  };
  const stem = matchFileStem(draftFile);
  batch.drafts = batch.drafts.map((d) => {
    if (d.file !== draftFile) return d;
    return {
      ...d,
      matchFile: `matches/${stem}.json`,
      matchOk: match.matchOk,
      matchQa: match.qa,
    };
  });
  fs.writeFileSync(indexPath, `${JSON.stringify(batch, null, 2)}\n`, "utf8");
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
      throw new Error("--date must be YYYY-MM-DD");
    }
    const drafts = listLocalDrafts(args.date).filter((d) => !args.file || d.file === args.file);
    if (!drafts.length) {
      console.log(JSON.stringify({ event: "blog_match_free_none", date: args.date }));
      return;
    }

    const results: Array<{
      file: string;
      qa: string;
      matchOk: boolean;
      count: number;
      seeded?: boolean;
      cached?: boolean;
    }> = [];

    for (const draft of drafts) {
      const story =
        anonymisedQueryFromDraft(draft.body) ||
        `${draft.title}. England. Who helps?`;
      const match = matchFreeDoorsForSituation({
        title: draft.title,
        matter: draft.matter,
        story,
      });
      writeMatchSnapshot(args.date, draft.file, match);
      updateIndexMatchMeta(args.date, draft.file, match);
      const cached = args.noCache ? false : warmCacheForStrongMatch(draft.title, story, match);

      let seeded = false;
      if (args.seed) {
        const next = seedDraftBodyFromMatch(draft.body, match);
        const bodyPath = path.join(
          process.cwd(),
          "data",
          "blog-drafts",
          args.date,
          draft.file,
        );
        fs.writeFileSync(bodyPath, next, "utf8");
        seeded = true;
      }

      results.push({
        file: draft.file,
        qa: match.qa,
        matchOk: match.matchOk,
        count: match.freeHelp.length,
        seeded,
        cached,
      });
    }

    console.log(
      JSON.stringify({
        event: "blog_match_free_batch",
        date: args.date,
        seed: args.seed,
        results,
      }),
    );
    return;
  }

  if (!args.title) {
    console.error(
      "Usage: blog:match-free --title \"...\" [--matter consumer] [--story \"...\"] OR --date YYYY-MM-DD [--seed]",
    );
    process.exit(1);
  }

  const match = matchFreeDoorsForSituation({
    title: args.title,
    matter: args.matter,
    story: args.story,
  });
  console.log(JSON.stringify(match, null, 2));
}

main();
