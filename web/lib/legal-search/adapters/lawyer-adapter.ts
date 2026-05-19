import "server-only";

import { hybridLawyerSearch } from "@/lib/lawyers/search";
import type { ExtractedFilters, AppliedFilters } from "@/lib/agent/types";
import { embedOne, embedConfigured } from "@/lib/llm/client";
import { enableVectorSearch } from "@/lib/legal-search/config";

export async function fetchLawyerCandidates(args: {
  extracted: ExtractedFilters;
  applied?: AppliedFilters;
  keyword: string;
}) {
  let embedding: Float32Array | null = null;
  if (enableVectorSearch() && embedConfigured()) {
    try {
      embedding = await embedOne(args.extracted.semanticQuery || args.keyword);
    } catch {
      embedding = null;
    }
  }
  return hybridLawyerSearch({
    extracted: args.extracted,
    applied: args.applied,
    embedding,
    keyword: args.keyword,
  });
}
