/**
 * Prisma 7 CLI config (migrate, generate, studio).
 * Connection URL lives here — not in schema.prisma.
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { defineConfig } from "prisma/config";

config({ path: resolve(process.cwd(), ".env") });
config({ path: resolve(process.cwd(), ".env.local"), override: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Generate/migrate need a URL in config; real connection uses DATABASE_URL from CI or .env.local.
    url:
      process.env.DATABASE_URL ??
      "postgresql://postgres:postgres@127.0.0.1:5432/legal_shaman?schema=public",
  },
});
