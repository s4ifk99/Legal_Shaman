"use client";

import { useRouter } from "next/navigation";
import { logRefinementClick } from "@/components/search-analytics";
import { Button } from "@/components/ui/button";
import type { RefinementChip } from "@/lib/legal/refinement-chips";
import { mergeRefinedSearchQuery } from "@/lib/legal/refinement-chips";
import type { SearchEventPage } from "@/lib/search-events/types";

type RefinementPromptTrackedProps = {
  q: string;
  question: string;
  page?: SearchEventPage;
  parsedPracticeArea?: string;
  parsedLocation?: string;
};

type RefinementChipsProps = {
  baseQuery: string;
  chips: RefinementChip[];
  page?: SearchEventPage;
  parsedPracticeArea?: string;
  parsedLocation?: string;
  freeOnly?: boolean;
  legalAidOnly?: boolean;
  city?: string;
};

function buildRefinementHref(
  baseQuery: string,
  chipValue: string,
  opts: { freeOnly?: boolean; legalAidOnly?: boolean; city?: string },
): string {
  const params = new URLSearchParams();
  const refined = mergeRefinedSearchQuery(baseQuery, chipValue);
  if (refined) params.set("q", refined);
  if (opts.freeOnly) params.set("free", "1");
  if (opts.legalAidOnly) params.set("legalAid", "1");
  if (opts.city?.trim()) params.set("city", opts.city.trim());
  const qs = params.toString();
  return qs ? `/search?${qs}` : "/search";
}

export function RefinementChips({
  baseQuery,
  chips,
  page = "directory",
  parsedPracticeArea,
  parsedLocation,
  freeOnly,
  legalAidOnly,
  city,
}: RefinementChipsProps) {
  const router = useRouter();

  if (!chips.length) return null;

  return (
    <div className="mt-3">
      <p className="mb-2 text-sm font-medium text-foreground">Narrow your search</p>
      <div className="flex flex-wrap gap-2">
        {chips.map((chip) => {
          const href = buildRefinementHref(baseQuery, chip.value, {
            freeOnly,
            legalAidOnly,
            city,
          });
          const refinedQuery = mergeRefinedSearchQuery(baseQuery, chip.value);

          return (
            <Button
              key={chip.id}
              type="button"
              variant="outline"
              size="sm"
              className="h-auto min-h-8 whitespace-normal px-3 py-1.5 text-left"
              onClick={() => {
                logRefinementClick({
                  q: refinedQuery,
                  page,
                  parsedPracticeArea,
                  parsedLocation,
                });
                router.push(href);
              }}
            >
              {chip.label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

/** Fallback when structured chips are unavailable (plain clarification text). */
export function RefinementPromptTracked({
  q,
  question,
  page = "directory",
  parsedPracticeArea,
  parsedLocation,
}: RefinementPromptTrackedProps) {
  return (
    <p className="mt-2 text-sm text-muted-foreground">
      <span className="font-medium text-foreground">Optional refinement: </span>
      {question}
    </p>
  );
}
