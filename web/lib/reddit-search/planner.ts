import { openRouterJsonCompletion } from "./openrouter-client";
import type { RedditResult, SearchPlan } from "./types";

const PLANNER_SYSTEM_PROMPT = `You are a legal Reddit search planner.

The user is looking for discussions on Reddit.

Generate:

* legal area
* issue summary
* 5 search queries

Return valid JSON only.`;

const REFINER_SYSTEM_PROMPT = `You are a legal Reddit search planner refining queries after an initial search.

The user is looking for discussions on Reddit in r/LegalAdviceUK.

Given the user query, prior plan, and sample results, generate:

* legal area (updated if needed)
* issue summary (updated if needed)
* 5 NEW search queries that explore different angles, synonyms, and related terms

Do not repeat prior queries verbatim. Prefer UK-specific legal phrasing where appropriate.

Return valid JSON only.`;

const QUERIES_PER_ROUND = 5;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeQueryList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];

  const queries = raw
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);

  return [...new Set(queries)].slice(0, QUERIES_PER_ROUND);
}

function parseSearchPlan(raw: unknown, fallbackQuery: string): SearchPlan {
  if (!isRecord(raw)) {
    throw new Error("Search plan response was not a JSON object");
  }

  const legal_area =
    typeof raw.legal_area === "string" ? raw.legal_area.trim() : "";
  const issue_summary =
    typeof raw.issue_summary === "string" ? raw.issue_summary.trim() : "";
  let search_queries = normalizeQueryList(raw.search_queries);

  if (search_queries.length === 0) {
    search_queries = [fallbackQuery];
  }

  while (search_queries.length < QUERIES_PER_ROUND) {
    search_queries.push(search_queries[search_queries.length - 1] ?? fallbackQuery);
  }

  return {
    legal_area: legal_area || "General legal",
    issue_summary: issue_summary || fallbackQuery,
    search_queries: search_queries.slice(0, QUERIES_PER_ROUND),
  };
}

/**
 * Generate a legal-area summary and five Reddit search queries for the user query.
 */
export async function generateQueries(userQuery: string): Promise<SearchPlan> {
  const trimmed = userQuery.trim();
  if (!trimmed) {
    throw new Error("userQuery must not be empty");
  }

  const raw = await openRouterJsonCompletion(
    PLANNER_SYSTEM_PROMPT,
    `Return JSON with this shape:
{
  "legal_area": "",
  "issue_summary": "",
  "search_queries": ["", "", "", "", ""]
}

User query:
${trimmed}`,
  );

  return parseSearchPlan(raw, trimmed);
}

/**
 * Generate refined search queries for a second retrieval round.
 */
export async function generateRefinedQueries(
  userQuery: string,
  previousPlan: SearchPlan,
  previousResults: RedditResult[],
): Promise<SearchPlan> {
  const trimmed = userQuery.trim();
  if (!trimmed) {
    throw new Error("userQuery must not be empty");
  }

  const sampleTitles = previousResults
    .slice(0, 8)
    .map((r) => `- ${r.title} (${r.url})`)
    .join("\n");

  const raw = await openRouterJsonCompletion(
    REFINER_SYSTEM_PROMPT,
    `Return JSON with this shape:
{
  "legal_area": "",
  "issue_summary": "",
  "search_queries": ["", "", "", "", ""]
}

User query:
${trimmed}

Previous legal area:
${previousPlan.legal_area}

Previous issue summary:
${previousPlan.issue_summary}

Previous queries:
${previousPlan.search_queries.map((q) => `- ${q}`).join("\n")}

Sample prior results:
${sampleTitles || "(none)"}`,
  );

  const plan = parseSearchPlan(raw, trimmed);

  const prior = new Set(previousPlan.search_queries.map((q) => q.toLowerCase()));
  plan.search_queries = plan.search_queries.map((q, idx) => {
    if (prior.has(q.toLowerCase())) {
      return `${q} UK legal advice ${idx + 1}`.trim();
    }
    return q;
  });

  return plan;
}
