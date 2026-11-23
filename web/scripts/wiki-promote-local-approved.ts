/**
 * Promote Approved local blog drafts for one batch date.
 *
 * Usage:
 *   npm run wiki:promote-local-approved -- --date 2026-11-06
 *   npm run wiki:promote-local-approved -- --date 2026-11-06 --file 09-conditional-sale-car-taken-back-who-helps.md
 *
 * Reads web/data/blog-drafts/<date>/, promotes each Approved draft via
 * wiki-promote-approved, then marks the draft Published and appends published.json.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  anonymisedQueryFromDraft,
  draftBodyToWikiMarkdown,
  listLocalDrafts,
  overlapIdsFromDraft,
  readMatchSnapshot,
  recordLocalPublish,
  wikiDirForMatter,
} from "../lib/blog-drafts/local-queue";
import { writeWhoHelpsFreeHelpCache } from "../lib/coherence/whoHelpsFreeHelpCache.node";

function parseArgs(argv: string[]) {
  let date: string | undefined;
  let file: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--date") date = argv[++i];
    if (argv[i] === "--file") file = argv[++i];
  }
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Required: --date YYYY-MM-DD");
  }
  return { date, file };
}

function main() {
  const { date, file } = parseArgs(process.argv.slice(2));
  const drafts = listLocalDrafts(date).filter((d) => {
    if (d.status !== "Approved") return false;
    if (file && d.file !== file) return false;
    return true;
  });

  if (!drafts.length) {
    console.log(JSON.stringify({ event: "wiki_promote_local_none", date, file: file ?? null }));
    return;
  }

  const promoteScript = resolve(process.cwd(), "scripts/wiki-promote-approved.ts");
  const tmp = mkdtempSync(join(tmpdir(), "ls-blog-promote-"));
  const results: Array<{ file: string; wikiId?: string; liveUrl?: string; error?: string }> = [];

  for (const draft of drafts) {
    try {
      const markdown = draftBodyToWikiMarkdown(draft.body, draft.title);
      const title = draft.title.replace(/\?+$/, "").trim();
      const input = {
        title,
        wikiRelativeDir: wikiDirForMatter(draft.matter, draft.title),
        markdown,
        overlapWikiIds: overlapIdsFromDraft(draft.body),
        pinSitemap: true,
      };
      const inputPath = join(tmp, `${draft.file}.json`);
      writeFileSync(inputPath, `${JSON.stringify(input, null, 2)}\n`, "utf8");

      const run = spawnSync(
        "npx",
        ["tsx", promoteScript, "--input", inputPath],
        { cwd: process.cwd(), encoding: "utf8", shell: false },
      );
      if (run.status !== 0) {
        throw new Error((run.stderr || run.stdout || `exit ${run.status}`).trim());
      }
      const line = (run.stdout || "")
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .pop();
      const payload = line ? (JSON.parse(line) as { wikiId?: string; liveUrl?: string }) : {};
      if (!payload.wikiId || !payload.liveUrl) {
        throw new Error(`Promote did not return wikiId/liveUrl: ${run.stdout}`);
      }
      recordLocalPublish(date, draft.file, {
        title,
        wikiId: payload.wikiId,
        liveUrl: payload.liveUrl,
        file: draft.file,
      });

      const match = readMatchSnapshot(date, draft.file);
      if (match?.freeHelp?.length) {
        const anon = anonymisedQueryFromDraft(draft.body);
        writeWhoHelpsFreeHelpCache({
          queryKeys: [title, draft.title, match.query, anon].filter(
            (s): s is string => Boolean(s && s.trim()),
          ),
          title,
          wikiId: payload.wikiId,
          liveUrl: payload.liveUrl,
          freeHelp: match.freeHelp,
          publishedAt: new Date().toISOString(),
          stage: "published",
        });
      }

      results.push({ file: draft.file, wikiId: payload.wikiId, liveUrl: payload.liveUrl });
    } catch (err) {
      results.push({
        file: draft.file,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  console.log(
    JSON.stringify({
      event: "wiki_promote_local_done",
      date,
      promoted: results.filter((r) => r.wikiId).length,
      failed: results.filter((r) => r.error).length,
      results,
    }),
  );
  if (results.some((r) => r.error)) process.exitCode = 1;
}

main();
