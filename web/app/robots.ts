import type { MetadataRoute } from "next";

const BASE = "https://www.legalshaman.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin/", "/api/", "/embed/"],
    },
    sitemap: `${BASE}/sitemap.xml`,
  };
}
