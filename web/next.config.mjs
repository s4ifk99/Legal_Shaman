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
  // Keep admin cron functions under Vercel's 250mb uncompressed limit.
  // wiki-index.json (~96mb) and Coherence catalogues are not needed by /api/admin/jobs/*.
  outputFileTracingExcludes: {
    "/api/admin/jobs/**": [
      "./data/wiki-index.json",
      "./data/coherence/**",
      "./data/legal-aid-listings.json",
    ],
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
