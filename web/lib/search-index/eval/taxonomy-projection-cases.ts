import { applyTaxonomyProjection } from "@/lib/search-index/taxonomy-projection";
import type { LegalEntityDocument } from "@/lib/search-index/types";
import { taxonomyFallbackQuery } from "@/lib/search-index/taxonomy-projection";

function baseDoc(over: Partial<LegalEntityDocument>): LegalEntityDocument {
  return {
    id: "test:1",
    entityType: "legal_aid_provider",
    title: "Test Provider",
    description: "",
    practiceAreas: [],
    categories: [],
    subIssues: [],
    searchText: "",
    expandedSearchText: "",
    source: "legal_aid",
    legalAid: true,
    authorityScore: 0.8,
    profileCompletenessScore: 0.5,
    rawSourceId: "1",
    updatedAt: Date.now(),
    ...over,
  };
}

export function runTaxonomyProjectionEval(): { failed: number; messages: string[] } {
  const messages: string[] = [];
  let failed = 0;
  const fail = (msg: string) => {
    messages.push(`FAIL ${msg}`);
    failed++;
  };

  const criminalPrison = applyTaxonomyProjection(
    baseDoc({
      title: "Smith Criminal Defence",
      practiceAreas: ["Criminal Defence"],
      description: "Parole board representation and licence recall advice",
      searchText: "criminal defence parole HMP",
    }),
  );
  if (!criminalPrison.practiceAreaSlugs?.includes("prison_law")) {
    fail("criminal defence + prison text should project prison_law slug");
  }
  if (!criminalPrison.relatedPracticeAreas?.includes("Prison Law")) {
    fail("should add Prison Law to relatedPracticeAreas");
  }
  if (!criminalPrison.taxonomyProjectionMatches?.length) {
    fail("should record taxonomyProjectionMatches");
  }

  const genericCriminal = applyTaxonomyProjection(
    baseDoc({
      practiceAreas: ["Criminal Defence"],
      description: "General motoring and fraud",
    }),
  );
  if (genericCriminal.practiceAreaSlugs?.includes("prison_law")) {
    fail("generic criminal defence must not project prison_law");
  }

  const fallback = taxonomyFallbackQuery("prison_law");
  if (!fallback.includes("prison") || !fallback.includes("criminal")) {
    fail("prison_law fallback query should include prison and criminal terms");
  }

  return { failed, messages };
}
