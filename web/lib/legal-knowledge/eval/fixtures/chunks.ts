import type { RetrievedChunk } from "@/lib/legal-knowledge/types";

export const COMMISSION_QUERY =
  "my employer hasnt paid me my comission i left the company last month";

export const PROPERTY_CHUNK: RetrievedChunk = {
  id: "p1",
  documentId: "d1",
  sourceUrl: "/ask-the-shaman/wiki/Areas%2FProperty",
  title: "Property — Sources",
  heading: null,
  chunkText: "articles on Property Law signposting only",
  chunkIndex: 0,
  tokenCount: 50,
  domain: "wiki.legalshaman",
  sourceName: "Legal Shaman Wiki",
  authorityWeight: 0.5,
  fetchedAt: new Date(),
  sourceUpdatedAt: null,
  snippet: "Property Law",
  relevanceScore: 0.5,
  authorityScore: 0.5,
  freshnessScore: 0.5,
  lexicalScore: 0.5,
  vectorScore: 0.5,
  phraseScore: 0.5,
  finalScore: 0.6,
};

export const EMPLOYMENT_CHUNK: RetrievedChunk = {
  ...PROPERTY_CHUNK,
  id: "e1",
  title: "Unpaid wages and commission",
  sourceUrl: "/ask-the-shaman/wiki/Areas%2FEmployment%2Fpay",
  chunkText: "ACAS guidance on unpaid commission after leaving employment",
  snippet: "unpaid commission",
  finalScore: 0.7,
};

export const WIKI_INDEX_CHUNK: RetrievedChunk = {
  ...PROPERTY_CHUNK,
  id: "w1",
  title: "Wiki index — all areas",
  sourceUrl: "/wiki/Areas",
  chunkText: "index of all legal areas on the wiki",
  snippet: "all areas",
  finalScore: 0.55,
};
