import type { MetadataRoute } from "next";
import { getWikiIndex } from "@/lib/wiki/load-index";
import { getAllSubcategories } from "@/lib/data";

const BASE = "https://www.legalshaman.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: BASE, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${BASE}/search`, lastModified: now, changeFrequency: "daily", priority: 0.95 },
    { url: `${BASE}/ask-the-shaman`, lastModified: now, changeFrequency: "daily", priority: 0.95 },
    { url: `${BASE}/find-a-lawyer`, lastModified: now, changeFrequency: "daily", priority: 0.95 },
    { url: `${BASE}/signposting`, lastModified: now, changeFrequency: "monthly", priority: 0.9 },
    { url: `${BASE}/bookmarks`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${BASE}/submit`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${BASE}/signpost`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${BASE}/for-firms`, lastModified: now, changeFrequency: "weekly", priority: 0.85 },
    { url: `${BASE}/embed/install`, lastModified: now, changeFrequency: "monthly", priority: 0.55 },
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
    // Prefer Areas/ editorial pages for the sitemap budget so Blog→wiki publishes
    // are discoverable (Directory firm pages dominate alphabetical order).
    const areas = index.pages.filter((p) => p.id.startsWith("Areas/"));
    const rest = index.pages.filter((p) => !p.id.startsWith("Areas/"));
    const capped = [...areas, ...rest].slice(0, 500);
    wikiRoutes = capped.map((page) => ({
      url: `${BASE}/ask-the-shaman/wiki/${encodeURIComponent(page.id)}`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: page.id.startsWith("Areas/") ? 0.65 : 0.5,
    }));
  } catch {
    wikiRoutes = [];
  }

  return [...staticRoutes, ...categoryRoutes, ...wikiRoutes];
}
