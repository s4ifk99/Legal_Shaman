/**
 * Reject practice areas that fail the strict legal taxonomy gate (marketing copy, headings, etc.).
 *
 * Usage:
 *   npm run providers:cleanup-bad-practice-areas
 *   npm run providers:cleanup-bad-practice-areas -- --dry-run
 *   npm run providers:cleanup-bad-practice-areas -- --limit=5000
 */
import "./load-dotenv";

import { runCleanupBadPracticeAreas } from "@/lib/provider-intelligence-crawler-v2/cleanup-bad-practice-areas";

function parseLimit(argv: string[]): number | undefined {
  const flag = argv.find((a) => a.startsWith("--limit="));
  if (!flag) return undefined;
  const n = Number(flag.split("=")[1]);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

async function main() {
  const argv = process.argv;
  const result = await runCleanupBadPracticeAreas({
    dryRun: argv.includes("--dry-run"),
    limit: parseLimit(argv),
  });
  console.info(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
