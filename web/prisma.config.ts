/**
 * Prisma 7 CLI config (migrate, generate, studio).
 * Connection URL lives here — not in schema.prisma.
 *
 * Prefer PRISMA_DATABASE_URL when set (used by db:migrate:accounts / db:migrate:data)
 * so .env.local cannot overwrite an explicit target URL.
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
    url:
      process.env.PRISMA_DATABASE_URL?.trim() ||
      process.env.DATABASE_URL?.trim() ||
      "postgresql://postgres:postgres@127.0.0.1:5432/legal_shaman?schema=public",
  },
});
