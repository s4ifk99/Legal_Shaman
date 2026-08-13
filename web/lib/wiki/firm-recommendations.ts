import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import { resolveLegalIssueFromQuery } from "@/lib/legal/taxonomy";
import type { WikiSearchHit } from "./search";

export type FirmRecommendationEntry = {
  firm: string;
  article_count: number;
  sra_id?: string;
  directory_url: string;
  source?: string;
};

export type FirmRecommendationsIndex = {
  built_at: string;
  min_articles: number;
  directory_base: string;
  practice_areas: Record<string, FirmRecommendationEntry[]>;
  topic_map: Record<string, string>;
};

const LOCAL_PATH = resolve(process.cwd(), "data/firm-topic-recommendations.json");

let _cache: FirmRecommendationsIndex | null = null;

/** Map taxonomy canonical names to firm-recommendations practice area keys. */
const TAXONOMY_TO_FIRM_AREA: Record<string, string> = {
  "Employment Law": "Employment Law",
  "Housing Law": "Housing Law",
  "Family Law": "Family Law",
  "Immigration Law": "Immigration Law",
  "Personal Injury": "Personal Injury",
  "Clinical Negligence": "Clinical Negligence",
  "Wills and Probate": "Wills and Probate",
  "Commercial Law": "Commercial Law",
  "Consumer Law": "Consumer Law",
  "Debt": "Debt",
  "Welfare Benefits": "Welfare Benefits",
  "Education Law": "Education Law",
  "Criminal Defence": "Criminal Defence",
  "Public Law and Judicial Review": "Public Law and Judicial Review",
  "Neighbour Disputes": "Neighbour Disputes",
  "Parking and PCNs": "Motoring Law",
  "Garage and Vehicle Repair Disputes": "Consumer Law",
  "Consumer services": "Consumer Law",
  "Motor purchase": "Consumer Law",
  "Mental Health Law": "General Legal Updates",
  "Community Care": "General Legal Updates",
};

export function getFirmRecommendationsIndex(): FirmRecommendationsIndex | null {
  if (_cache) return _cache;
  if (!existsSync(LOCAL_PATH)) return null;
  try {
    _cache = JSON.parse(readFileSync(LOCAL_PATH, "utf8")) as FirmRecommendationsIndex;
    return _cache;
  } catch {
    return null;
  }
}

function addPracticeArea(areas: Set<string>, name: string | undefined) {
  if (name?.trim()) areas.add(name.trim());
}

export function resolvePracticeAreasForWikiQuery(
  query: string,
  hits: WikiSearchHit[],
): string[] {
  const index = getFirmRecommendationsIndex();
  const areas = new Set<string>();

  const resolution = resolveLegalIssueFromQuery(query);
  if (resolution) {
    addPracticeArea(areas, TAXONOMY_TO_FIRM_AREA[resolution.canonicalName]);
    addPracticeArea(areas, resolution.canonicalName);
  }

  if (index) {
    for (const hit of hits) {
      addPracticeArea(areas, index.topic_map[hit.title]);
      for (const concept of hit.relatedConcepts) {
        addPracticeArea(areas, index.topic_map[concept]);
      }
      const categoryLabel = hit.category.replace(/_/g, " ");
      for (const [topic, area] of Object.entries(index.topic_map)) {
        if (
          hit.title.toLowerCase().includes(topic.toLowerCase()) ||
          categoryLabel.toLowerCase().includes(topic.toLowerCase())
        ) {
          addPracticeArea(areas, area);
        }
      }
    }
  }

  return [...areas];
}

export function pickRecommendedFirms(
  query: string,
  hits: WikiSearchHit[],
  limit = 5,
): Array<FirmRecommendationEntry & { practiceArea: string }> {
  const index = getFirmRecommendationsIndex();
  if (!index) return [];

  const practiceAreas = resolvePracticeAreasForWikiQuery(query, hits);
  const seen = new Set<string>();
  const picked: Array<FirmRecommendationEntry & { practiceArea: string }> = [];

  for (const area of practiceAreas) {
    const rows = index.practice_areas[area] ?? [];
    for (const row of rows) {
      const key = row.firm.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      picked.push({ ...row, practiceArea: area });
      if (picked.length >= limit) return picked;
    }
  }

  return picked;
}
