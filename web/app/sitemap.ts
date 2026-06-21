import type { MetadataRoute } from "next";
import { getWikiIndex } from "@/lib/wiki/load-index";
import { getAllSubcategories } from "@/lib/data";

const BASE = "https://www.legalshaman.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: BASE, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${BASE}/search`, lastModified: now, changeFrequency: "daily", priority: 0.95 },
    { url: `${BASE}/find-a-lawyer`, lastModified: now, changeFrequency: "weekly", priority: 0.95 },
    { url: `${BASE}/ask-the-shaman`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${BASE}/oslaw`, lastModified: now, changeFrequency: "daily", priority: 0.85 },
    { url: `${BASE}/signposting`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/bookmarks`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${BASE}/submit`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${BASE}/signpost`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${BASE}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
  ];

  let categoryRoutes: MetadataRoute.Sitemap = [];
  try {
    const slugs = getAllSubcategories();
    categoryRoutes = slugs.map((cat) => ({
      url: `${BASE}/category/${cat.slug}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    }));
  } catch {
    categoryRoutes = [];
  }

  let wikiRoutes: MetadataRoute.Sitemap = [];
  try {
    const index = getWikiIndex();
    wikiRoutes = index.pages.slice(0, 500).map((page) => ({
      url: `${BASE}/ask-the-shaman/wiki/${encodeURIComponent(page.id)}`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.5,
    }));
  } catch {
    wikiRoutes = [];
  }

  return [...staticRoutes, ...categoryRoutes, ...wikiRoutes];
}
