import { SITE } from "@/lib/seo/sitemaps";
import { latestGuideChange, listGuidesNewestFirst } from "@/lib/wiki/published";
import { wikiPagePublicPath } from "@/lib/wiki/public-url";

export const dynamic = "force-static";

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function plain(value: string): string {
  return value
    .replace(/\*\*/g, "")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Atom feed of the 50 newest who helps guides. Also submitted as a sitemap. */
export function GET() {
  const guides = listGuidesNewestFirst().slice(0, 50);
  const updated = latestGuideChange() ?? new Date().toISOString();
  const entries = guides
    .map((g) => {
      const url = `${SITE}${wikiPagePublicPath(g.id)}`;
      const published = g.publishedAt ?? updated;
      const changed = g.updatedAt ?? published;
      return `  <entry>
    <title>${esc(g.title)}</title>
    <link rel="alternate" type="text/html" href="${esc(url)}"/>
    <id>${esc(url)}</id>
    <published>${new Date(published).toISOString()}</published>
    <updated>${new Date(changed).toISOString()}</updated>
    <category term="${esc(g.id.split("/")[1] ?? g.category)}"/>
    <summary>${esc(plain(g.summary))}</summary>
  </entry>`;
    })
    .join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en-GB">
  <title>Legal Shaman: latest who helps guides</title>
  <subtitle>Free legal signposting guides for England and Wales. Signposting only, not legal advice.</subtitle>
  <link rel="self" type="application/atom+xml" href="${SITE}/feed.xml"/>
  <link rel="alternate" type="text/html" href="${SITE}/ask-the-shaman/who-helps"/>
  <id>${SITE}/feed.xml</id>
  <updated>${new Date(updated).toISOString()}</updated>
  <author><name>Legal Shaman</name></author>
${entries}
</feed>
`;
  return new Response(xml, {
    headers: {
      "content-type": "application/atom+xml; charset=utf-8",
      "cache-control": "public, max-age=0, must-revalidate",
    },
  });
}
