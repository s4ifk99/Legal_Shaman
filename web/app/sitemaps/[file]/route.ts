import {
  CHILD_SITEMAPS,
  childSitemapEntries,
  urlsetXml,
  XML_HEADERS,
  type ChildSitemap,
} from "@/lib/seo/sitemaps";

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return CHILD_SITEMAPS.map((name) => ({ file: `${name}.xml` }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const name = file.replace(/\.xml$/, "") as ChildSitemap;
  if (!CHILD_SITEMAPS.includes(name)) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(urlsetXml(childSitemapEntries(name)), { headers: XML_HEADERS });
}
