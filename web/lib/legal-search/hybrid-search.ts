import "server-only";

import type { SearchResult } from "@/lib/legal-search/types";
import { searchSraOrganisations } from "@/lib/search/meilisearch-sra";
import { searchSraOrganisationsPostgres } from "@/lib/search/postgres-sra";
import { unifiedSearchListings } from "@/lib/search/unified-search";
import type { SearchFacets } from "@/lib/search/rerank";
import { parseQuery } from "@/lib/legal-search/query-understanding";
import { rankSearchResults, sortByFinalScore } from "@/lib/legal-search/ranking";
import { loadBehaviouralSignalsForEntities } from "@/lib/search-events/load-ranking-signals";
import { attachExplanations } from "@/lib/legal-search/explanations";
import { fromSraMeili, fromUnifiedHit } from "@/lib/legal-search/adapters/listing-adapter";
import { enableMeilisearch } from "@/lib/legal-search/config";
import {
  buildVagueQueryRescuePlan,
  detectVagueLegalQuery,
  filterVagueRescueResults,
} from "@/lib/legal-search/vague-query-rescue";
import { detectFundingIntent } from "@/lib/legal-search/funding-intent";
import { applySourceDiversity } from "@/lib/legal-search/source-diversity";
import type { RetrievalSource } from "@/lib/legal-search/search-diagnostics-types";

/**
 * Collect directory + optional SRA Meilisearch hits, rank, explain.
 */
export async function mergeAndRankDirectoryHits(args: {
  query: string;
  limit: number;
  semantic: boolean;
  facets?: SearchFacets;
  /** When false, only listing unified path (legacy-equivalent merge without SRA). */
  includeSra?: boolean;
  /** When set, avoids a second parseQuery call. */
  parsed?: import("@/lib/legal-search/types").ParsedQuery;
}): Promise<{
  results: SearchResult[];
  degradedModes: string[];
  parsed: import("@/lib/legal-search/types").ParsedQuery;
}> {
  const degradedModes: string[] = [];
  const { query, limit, semantic, facets, includeSra = true } = args;
  const parsed = args.parsed ?? (await parseQuery(query));
  const vagueQueryMode = detectVagueLegalQuery(parsed, {
    cityFilter: facets?.city,
  });
  const rescuePlan = vagueQueryMode ? buildVagueQueryRescuePlan(parsed) : null;
  const retrievalQueries = vagueQueryMode && rescuePlan
    ? rescuePlan.retrievalQueries
    : [parsed.expandedSearchText?.trim() || query];

  const hitMap = new Map<string, ReturnType<typeof fromUnifiedHit>>();
  for (const rq of retrievalQueries.slice(0, 6)) {
    const hits = await unifiedSearchListings(query, {
      limit: Math.min(120, limit * 2),
      semantic,
      facets,
      retrievalQuery: rq,
    });
    for (const h of hits) {
      const key =
        h.kind === "adlGroup"
          ? `g:${h.firmGroupId}`
          : `adl:${h.hit.listing.id}`;
      if (!hitMap.has(key)) hitMap.set(key, fromUnifiedHit(h, parsed));
    }
  }

  let results: SearchResult[] = [...hitMap.values()];
  const retrieval = parsed.expandedSearchText?.trim() || query;

  if (includeSra && retrieval.length >= 2) {
    const city = facets?.city?.trim() || parsed.location || undefined;
    const sraSearchQuery = query.trim() || retrieval;
    const sraOpts = {
      limit: Math.min(80, Math.max(40, limit)),
      city: city && city.length > 1 ? city : undefined,
    };
    let sraDocs: Awaited<ReturnType<typeof searchSraOrganisations>> = [];

    if (enableMeilisearch()) {
      try {
        sraDocs = await searchSraOrganisations(retrieval, sraOpts);
        if (sraDocs.length === 0) {
          sraDocs = await searchSraOrganisations(sraSearchQuery, sraOpts);
        }
      } catch {
        degradedModes.push("meilisearch_sra");
      }
    } else {
      degradedModes.push("meilisearch_disabled");
    }

    if (sraDocs.length === 0) {
      const pgDocs = await searchSraOrganisationsPostgres(sraSearchQuery, sraOpts);
      if (pgDocs.length > 0) {
        sraDocs = pgDocs;
        degradedModes.push("postgres_sra_fallback");
      }
    }

    if (sraDocs.length > 0) {
      const source: RetrievalSource = degradedModes.includes("postgres_sra_fallback")
        ? "ilike"
        : "meilisearch";
      results = [...results, ...sraDocs.map((d) => fromSraMeili(d, parsed, source))];
    }
  }

  const behaviouralSignals = await loadBehaviouralSignalsForEntities(
    results.map((r) => ({ id: r.id, source: r.source })),
    { practiceArea: parsed.practiceAreaSlug, city: parsed.location },
  );
  const ranked = sortByFinalScore(
    rankSearchResults(results, parsed, {
      behaviouralSignals,
      vagueQueryMode,
      vagueRescuePlan: rescuePlan ?? undefined,
    }),
  );
  let filtered = vagueQueryMode && rescuePlan
    ? filterVagueRescueResults(ranked, rescuePlan)
    : ranked;
  if (vagueQueryMode && rescuePlan && filtered.length < 3) {
    degradedModes.push("vague_rescue_fallback");
    const broadHits = await unifiedSearchListings(rescuePlan.canonicalName, {
      limit: Math.min(120, limit * 3),
      semantic: true,
      facets: undefined,
      retrievalQuery: rescuePlan.retrievalQueries.join(" "),
    });
    const extra = broadHits.map((h) => fromUnifiedHit(h, parsed));
    const ids = new Set(filtered.map((r) => r.id));
    filtered = [
      ...filtered,
      ...filterVagueRescueResults(
        extra.filter((r) => !ids.has(r.id)),
        rescuePlan,
      ),
    ];
    filtered = sortByFinalScore(
      rankSearchResults(filtered, parsed, {
        behaviouralSignals,
        vagueQueryMode: true,
        vagueRescuePlan: rescuePlan,
      }),
    );
  }
  const fundingIntent = parsed.fundingIntent ?? detectFundingIntent(parsed.semanticQuery);
  const diversified = applySourceDiversity(filtered, fundingIntent, {
    topK: Math.min(10, limit),
    query,
  });
  const sliced = diversified.results.slice(0, limit);
  const explained = attachExplanations(sliced, parsed, rescuePlan ?? undefined);
  if (vagueQueryMode) degradedModes.push("vague_query_rescue");
  return { results: explained, degradedModes, parsed };
}
