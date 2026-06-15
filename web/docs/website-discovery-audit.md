# Website discovery audit (`providers:discover-websites`)

End-to-end trace for the current (non-agentic) pipeline before agentic discovery.

## Entry point

`npm run providers:discover-websites` → `scripts/providers-discover-websites.ts`

1. Load SRA index documents + enrichment map.
2. `planWeakProviders()` — SRA orgs missing `website` (and other weak fields).
3. For each target (default `--limit=100`): create `provider_crawl_runs` row (`discover_website`), run `runWebsiteDiscoveryEngine()`, complete run.

## Query generation

`buildFirmWebsiteSearchQueries(seed)` in `lib/provider-osint/firm-search-queries.ts`

- Requires a real firm name (not SRA-id placeholder).
- Up to 6 queries, e.g.:
  - `"Firm Name" solicitors`
  - `"Firm Name" contact`
  - `"Firm Name" law firm`
  - `Firm Name solicitors UK`
  - Optional city/postcode variants when location is useful.
- Never builds domains from postcode, city, country, or SRA id.

## Search providers

`searchWebForFirmQueries()` in `lib/provider-osint/firm-web-search.ts`

- **DuckDuckGo HTML** (`https://html.duckduckgo.com/html/`) — no API key.
- Rate-limited (`PROVIDER_WEBSITE_SEARCH_INTERVAL_MS`, default 1200ms).
- Skipped when `PROVIDER_WEBSITE_SEARCH_SKIP=1`.
- Regulatory/directory URLs filtered at parse time.
- Deduplicates by origin; stops after ~12 unique origins.

## Candidate collection

`discoverWebsiteOsint()` in `lib/provider-osint/website-discovery.ts` merges:

| Source | Function | Evidence type |
|--------|----------|----------------|
| SRA register field + search text URL | `discoverWebsitesFromFirmNameSearch` | `registry_supplied` |
| SRA ladder fields | `discoverFromSraFields` | `registry_supplied` |
| Law Society lookup | `discoverWebsiteViaLawSociety` | `registry_supplied` / law_society source |
| Web search hits (top 6) | DDG results + homepage fetch | `search_result` → `page_verified` if homepage checks pass |

Heuristic domain guessing (`discoverWebsiteFromFirmNameHeuristic`) is **disabled** (always `null`).

## Scoring

`lib/provider-osint/website-candidate-evidence.ts`

- **Registry:** `scoreRegistryWebsiteCandidate` — domain token match, synthetic check, directory block; base ~0.72+.
- **Search:** `scoreSearchResultCandidate` — domain score, title similarity, optional homepage verification boost; floors:
  - `search_result`: confidence ≥ **0.75** to persist
  - `page_verified`: confidence ≥ **0.85** to persist
- **Pick best:** `pickBestScoredCandidate` — type order: `page_verified` > `registry_supplied` > `search_result`.

Homepage verification: `verifyFirmWebsiteHomepage()` — fetch HTML, firm tokens, legal keywords, location match (`PROVIDER_WEBSITE_VERIFY_SKIP_FETCH=1` to skip).

## Persistence

`runWebsiteDiscoveryEngine()` → `discoverWebsiteCandidates()` → `approveAndPersistV2Candidate()`

- Writes `provider_websites` + syncs `provider_enrichments` (`fieldName=website`).
- Gates: regulatory URL, `heuristic_guess`, moderation floor, synthetic domain (`synthetic_generated_domain`).
- V2 approval: `resolveV2Approval()` — websites typically **pending_review** unless global cache / high confidence contact rules apply.

Also runs `runLadderForProvider(..., "discover_website")` for legacy ladder side effects.

## Moderation

- `candidateMayEnterModeration()` type/confidence floors.
- `submitEnrichmentCandidate()` / V2 persist: auto-approve rare for websites; most land in **pending_review**.
- Admin review via provider enrichment UI / crawl v2 review commands.

## Debug output (`--debug`)

Per provider JSON row:

- `providerId`, `displayName`, `queries`, `searchResultsSeen`, `searchResultUrls`
- `candidateUrls`, `candidateTypes`, `candidateScores`, `candidateEntries` (with `source`, `mayPersist`, `rejectReason`)
- `finalDecision` (`status:policyReason` or `no_candidate:…`)

Batch `summary`: `candidatesCollected`, `candidatesVerified`, `candidatesRejected`, `noCandidate`.

## Sample run (`--limit=25 --debug`, 2026-06-03)

| Metric | Value |
|--------|-------|
| targets | 25 |
| firmNamesUsed (queries built) | 13 / 25 |
| searchResultsSeen | **0** (DDG HTML markup no longer matches `result__a` parser; HTTP 202 landing page) |
| candidatesFound / persisted | 0 |
| noCandidate | 25 |
| pendingReview / autoApproved | 2 / 1 (from legacy `runLadderForProvider`, not website discovery) |

Many targets still have **placeholder display names** (e.g. `London, SW1E 5BY`, `Dubai, United Arab Emirates`) — identity recovery must run before search can succeed.

## Agentic discovery — would it help?

**Yes, materially**, but only after:

1. **Identity** — real firm names (SRA API / Serper / Law Society), not address strings.
2. **Search API** — replace or fix DuckDuckGo HTML scraping (or use Serper like identity recovery).
3. **Multi-step reasoning** — disambiguate SERP, verify homepage, reject directories.

Agentic loops add little value while `searchResultsSeen=0` and queries use geographic placeholders.
