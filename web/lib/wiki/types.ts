export type WikiSourceConfig = {
  wikiRoot: string;
  wikiPagesDir: string;
  rawDir: string;
  logsDir: string;
};

export type WikiPageIndex = {
  id: string;
  title: string;
  filePath: string;
  relativePath: string;
  category: string;
  summary: string;
  keyInformation: string[];
  practicalGuidance: string[];
  relatedConcepts: string[];
  relatedOrganisations: string[];
  sources: string[];
  content: string;
};

export type WikiIndex = {
  meta: {
    indexedAt: string;
    pageCount: number;
    wikiRoot: string;
    wikiPagesDir: string;
  };
  pages: WikiPageIndex[];
};
