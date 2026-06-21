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
  async redirects() {
    return [
      { source: "/oslr", destination: "/oslaw", permanent: true },
      { source: "/oslr/:path*", destination: "/oslaw/:path*", permanent: true },
    ];
  },
  // When the repo root has another lockfile (e.g. pnpm), Turbopack must treat `web/` as the app root.
  turbopack: {
    root: __dirname,
  },
}

export default nextConfig
