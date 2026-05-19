import type { SearchResult } from "@/lib/legal-search/types";
import type {
  FundingRoute,
  TriageResultSection,
  TriageSectionKind,
} from "@/lib/legal-search/triage/types";
import {
  LEGAL_AID_ENTITY_TYPES,
  PRIVATE_ENTITY_TYPES,
  PRO_BONO_ENTITY_TYPES,
} from "@/lib/legal-search/triage/types";
import { sectionTitleForKind } from "@/lib/legal-search/triage/funding-router";

function entityTypeOf(r: SearchResult): string {
  const raw = r.raw as { entityType?: string } | null;
  return String(raw?.entityType ?? "");
}

export function classifySearchResult(r: SearchResult): TriageSectionKind {
  const et = entityTypeOf(r);
  const raw = r.raw as { legalAid?: boolean } | null;
  if (
    (LEGAL_AID_ENTITY_TYPES as readonly string[]).includes(et) ||
    r.source === "legal_aid" ||
    raw?.legalAid === true
  ) {
    return "legal_aid";
  }
  if ((PRO_BONO_ENTITY_TYPES as readonly string[]).includes(et)) {
    return "pro_bono";
  }
  return "private";
}

export function groupResultsByFundingRoute(
  results: SearchResult[],
  routeOrder: FundingRoute[],
  limitPerSection = 10,
): TriageResultSection[] {
  const buckets: Record<TriageSectionKind, SearchResult[]> = {
    legal_aid: [],
    pro_bono: [],
    private: [],
  };

  for (const r of results) {
    buckets[classifySearchResult(r)].push(r);
  }

  const sections: TriageResultSection[] = [];
  for (const route of routeOrder) {
    const kind: TriageSectionKind =
      route === "legal_aid" ? "legal_aid" : route === "pro_bono" ? "pro_bono" : "private";
    const slice = buckets[kind].slice(0, limitPerSection);
    if (slice.length) {
      sections.push({
        kind,
        title: sectionTitleForKind(route),
        results: slice,
      });
    }
  }

  return sections;
}

export function flattenSections(sections: TriageResultSection[]): SearchResult[] {
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const s of sections) {
    for (const r of s.results) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push(r);
    }
  }
  return out;
}

export function buildMapMarkersFromResults(
  results: SearchResult[],
): { id: string; lat: number; lng: number; title: string }[] {
  return results
    .filter((r) => r.location?.lat != null && r.location?.lng != null)
    .map((r) => ({
      id: r.id,
      lat: r.location!.lat!,
      lng: r.location!.lng!,
      title: r.title,
    }));
}
