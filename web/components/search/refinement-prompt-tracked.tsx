"use client";

import { logRefinementClick } from "@/components/search-analytics";
import type { SearchEventPage } from "@/lib/search-events/types";

type RefinementPromptTrackedProps = {
  q: string;
  question: string;
  page?: SearchEventPage;
  parsedPracticeArea?: string;
  parsedLocation?: string;
};

export function RefinementPromptTracked({
  q,
  question,
  page = "directory",
  parsedPracticeArea,
  parsedLocation,
}: RefinementPromptTrackedProps) {
  return (
    <button
      type="button"
      className="mt-2 block text-left text-muted-foreground hover:text-foreground"
      onClick={() =>
        logRefinementClick({ q, page, parsedPracticeArea, parsedLocation })
      }
    >
      <span className="font-medium text-foreground">Optional refinement: </span>
      {question}
    </button>
  );
}
