/**
 * Future UK legal-help crawler (GOV.UK, Citizens Advice, etc.).
 * MVP uses wiki markdown import; this module documents the ingestion contract.
 */

export type CrawlPage = {
  sourceUrl: string;
  title: string;
  domain: string;
  rawHtml?: string;
  cleanText: string;
  markdown?: string;
  fetchedAt: Date;
  sourceUpdatedAt?: Date | null;
};

export type CrawlOptions = {
  respectRobotsTxt?: boolean;
  userAgent?: string;
  delayMs?: number;
};

/** Placeholder — implement per-domain fetchers with robots.txt checks. */
export async function crawlTrustedSource(
  _domain: string,
  _options: CrawlOptions = {},
): Promise<CrawlPage[]> {
  throw new Error(
    "Web crawler not implemented in MVP. Use npm run ingest:legal-knowledge for wiki markdown import.",
  );
}

export const PLANNED_CRAWL_DOMAINS = [
  "gov.uk",
  "citizensadvice.org.uk",
  "lawsociety.org.uk",
  "sra.org.uk",
  "lawworks.org.uk",
  "weareadvocate.org.uk",
  "advicenow.org.uk",
] as const;
