import { sitemapIndexEntries, sitemapIndexXml, XML_HEADERS } from "@/lib/seo/sitemaps";

export const dynamic = "force-static";

/** Sitemap index: static pages, latest guides, all guides, area hubs, legacy redirects. */
export function GET() {
  return new Response(sitemapIndexXml(sitemapIndexEntries()), { headers: XML_HEADERS });
}
