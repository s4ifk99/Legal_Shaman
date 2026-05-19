"use client";

import { TriageGuidedSearch } from "@/components/triage/triage-guided-search";

type LawyerSearchClientProps = {
  mapEnabled?: boolean;
  debugEnabled?: boolean;
};

/** Guided triage search for /find-a-lawyer (signposting only, not legal advice). */
export function LawyerSearchClient(props: LawyerSearchClientProps) {
  return <TriageGuidedSearch {...props} />;
}
