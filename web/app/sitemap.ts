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
    // Blog→wiki publishes must stay in the 500-URL budget (Areas alone is ~2.6k).
    const priorityIds = new Set([
      "Areas/Consumer Rights/Faulty Goods and Services/Courier left my parcel outside and it went missing — can I use Section 75",
      "Areas/Consumer Rights/Faulty Goods and Services/A company called my private number with my name and job title — what can I do",
      "Areas/Home and Housing/Buying and Selling/Ground rent reviewed every 10 years by RPI — what should a buyer check",
    ]);
    const priority = index.pages.filter((p) => priorityIds.has(p.id));
    const areas = index.pages.filter(
      (p) => p.id.startsWith("Areas/") && !priorityIds.has(p.id),
    );
    const rest = index.pages.filter(
      (p) => !p.id.startsWith("Areas/") && !priorityIds.has(p.id),
    );
    const capped = [...priority, ...areas, ...rest].slice(0, 500);
    wikiRoutes = capped.map((page) => ({
      url: `${BASE}/ask-the-shaman/wiki/${encodeURIComponent(page.id)}`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: priorityIds.has(page.id)
        ? 0.75
        : page.id.startsWith("Areas/")
          ? 0.65
          : 0.5,
    }));
  } catch {
    wikiRoutes = [];
  }

  return [...staticRoutes, ...categoryRoutes, ...wikiRoutes];
}
