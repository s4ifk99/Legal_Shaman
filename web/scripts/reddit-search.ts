/**
 * Agentic Reddit search for r/LegalAdviceUK.
 *
 * Uses LLM_API_KEY / LLM_BASE_URL from web/.env.local (same as /find-a-lawyer).
 * Reddit script-app credentials also go in .env.local.
 *
 * Usage:
 *   npm run reddit:search -- "landlord won't return deposit"
 */
import "./load-dotenv";

import { redditAgentSearch } from "../lib/reddit-search";

function parseQuery(argv: string[]): string | null {
  const flag = argv.find((a) => a.startsWith("--query="));
  if (flag) return flag.split("=").slice(1).join("=").trim() || null;

  const idx = argv.indexOf("--query");
  if (idx >= 0 && argv[idx + 1]) return argv[idx + 1]!.trim();

  const positional = argv.filter((a) => !a.startsWith("-"));
  if (positional.length > 0) return positional.join(" ").trim();

  return null;
}

async function main() {
  const query = parseQuery(process.argv.slice(2));
  if (!query) {
    console.error('Usage: npm run reddit:search -- "your legal question"');
    process.exit(1);
  }

  console.info(`[reddit:search] query="${query}"`);

  const result = await redditAgentSearch(query);

  console.info(
    JSON.stringify(
      {
        event: "reddit_agent_search",
        legal_area: result.legal_area,
        issue_summary: result.issue_summary,
        enough_good_results: result.enough_good_results,
        rounds_used: result.rounds_used,
        result_count: result.results.length,
        results: result.results,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
