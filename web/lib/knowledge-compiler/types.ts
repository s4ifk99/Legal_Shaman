import type { WikiPageIndex } from "@/lib/wiki/types";

export type KnowledgeEdgeType = "related" | "parent_area" | "sub_issue";

export type ConceptNode = {
  id: string;
  taxonomySlug: string | null;
  wikiPageId: string;
  title: string;
  areaPath: string | null;
  summaryText: string | null;
  page?: WikiPageIndex;
};

export type ConceptCluster = {
  primary: ConceptNode;
  related: ConceptNode[];
  depth: number;
};

export type MergeAction =
  | { type: "update_section"; wikiPageId: string; section: string; bullets: string[] }
  | { type: "create_page"; areaPath: string; title: string; sections: Record<string, string[]> }
  | { type: "add_wikilink"; fromWikiPageId: string; toTitle: string }
  | { type: "append_source"; wikiPageId: string; sourceUrl: string };

export type ExtractedSource = {
  claims: Array<{
    claimText: string;
    sectionTarget: "Summary" | "Key Information" | "Practical Guidance" | "Sources";
    conceptHint?: string;
    taxonomySlug?: string;
  }>;
  concepts: Array<{ title: string; taxonomySlug?: string }>;
  organisations: string[];
  sources: string[];
};

export type GraphAssemblyResult = {
  answer: string;
  sources: Array<{ title: string; url: string; source: string; snippet: string; score: number }>;
  confidence: number;
  conceptCluster: ConceptCluster;
  clarifyingQuestion: string | null;
};
