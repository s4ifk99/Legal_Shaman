import type { MetadataRoute } from "next";
import { getWikiIndex } from "@/lib/wiki/load-index";
import { getAllSubcategories } from "@/lib/data";
import { wikiPagePublicPath } from "@/lib/wiki/public-url";
import {
  SITEMAP_PRIORITY_WIKI_IDS,
  outsideEnglandAndWales,
} from "@/lib/wiki/sitemap-priority";

const BASE = "https://www.legalshaman.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: BASE, changeFrequency: "daily", priority: 1 },
    { url: `${BASE}/search`, changeFrequency: "daily", priority: 0.95 },
    { url: `${BASE}/ask-the-shaman`, changeFrequency: "daily", priority: 0.95 },
    { url: `${BASE}/ask-the-shaman/who-helps`, changeFrequency: "weekly", priority: 0.9 },
    { url: `${BASE}/signposting`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${BASE}/for-firms`, changeFrequency: "weekly", priority: 0.85 },
    { url: `${BASE}/terms`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE}/privacy`, changeFrequency: "yearly", priority: 0.3 },
  ];

  let categoryRoutes: MetadataRoute.Sitemap = [];
  try {
    const slugs = getAllSubcategories();
    categoryRoutes = slugs.map((cat) => ({
      url: `${BASE}/category/${cat.slug}`,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    }));
  } catch {
    categoryRoutes = [];
  }

  let wikiRoutes: MetadataRoute.Sitemap = [];
  try {
    const index = getWikiIndex();
    const priorityIds = new Set<string>(SITEMAP_PRIORITY_WIKI_IDS);
    const priority = index.pages.filter(
      (p) => priorityIds.has(p.id) && !outsideEnglandAndWales(p.id),
    );
    wikiRoutes = priority.map((page) => ({
      url: `${BASE}${wikiPagePublicPath(page.id)}`,
      changeFrequency: "monthly" as const,
      priority: 0.75,
    }));
  } catch {
    wikiRoutes = [];
  }

  return [...staticRoutes, ...categoryRoutes, ...wikiRoutes];
}
