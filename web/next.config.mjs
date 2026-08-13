import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // Keep serverless functions under Vercel's 250mb uncompressed limit.
  // Keys match route paths and (for Turbopack/Webpack NFT) app/ prefixed entry names.
  outputFileTracingExcludes: {
    "/api/admin/**": [
      "./data/wiki-index.json",
      "./data/coherence/**",
      "./data/legal-aid-listings.json",
    ],
    "app/api/admin/**": [
      "./data/wiki-index.json",
      "./data/coherence/**",
      "./data/legal-aid-listings.json",
    ],
  },
  outputFileTracingIncludes: {
    "/ask-the-shaman": ["./data/wiki-index.json"],
    "/ask-the-shaman/wiki/[slug]": ["./data/wiki-index.json"],
    "/api/ask/**": ["./data/wiki-index.json"],
    "/api/coherence/**": ["./data/wiki-index.json", "./data/coherence/**"],
    "app/ask-the-shaman/**": ["./data/wiki-index.json"],
    "app/api/ask/**": ["./data/wiki-index.json"],
    "app/api/coherence/**": ["./data/wiki-index.json", "./data/coherence/**"],
  },
  async redirects() {
    return [
      { source: "/find-a-lawyer", destination: "/ask-the-shaman?guided=1", permanent: false },
      { source: "/oslaw", destination: "/ask-the-shaman", permanent: false },
      { source: "/oslr", destination: "/ask-the-shaman", permanent: true },
      { source: "/oslr/:path*", destination: "/oslaw/:path*", permanent: true },
    ];
  },
  // When the repo root has another lockfile (e.g. pnpm), Turbopack must treat `web/` as the app root.
  turbopack: {
    root: __dirname,
  },
}

export default nextConfig
