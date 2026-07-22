/**
 * Run Prisma migrate deploy against accounts or data database.
 * Usage:
 *   tsx scripts/prisma-migrate-target.ts accounts
 *   tsx scripts/prisma-migrate-target.ts data
 */
import "./load-dotenv";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const target = (process.argv[2] || "").toLowerCase();
if (target !== "accounts" && target !== "data") {
  console.error("Usage: tsx scripts/prisma-migrate-target.ts <accounts|data>");
  process.exit(1);
}

const url =
  target === "accounts"
    ? process.env.ACCOUNTS_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim()
    : process.env.DATA_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();

if (!url) {
  console.error(
    target === "accounts"
      ? "Set ACCOUNTS_DATABASE_URL (or DATABASE_URL) for the Neon accounts database."
      : "Set DATA_DATABASE_URL (or DATABASE_URL) for the home/data Postgres database.",
  );
  process.exit(1);
}

const host = url.match(/@([^/?]+)/)?.[1] ?? "(unknown host)";
console.info(JSON.stringify({ event: "prisma_migrate_target", target, host }));

const prismaBin = resolve(process.cwd(), "node_modules", ".bin", "prisma");
const r = spawnSync(prismaBin, ["migrate", "deploy"], {
  stdio: "inherit",
  // PRISMA_DATABASE_URL wins over .env.local in prisma.config.ts
  env: { ...process.env, PRISMA_DATABASE_URL: url, DATABASE_URL: url },
  cwd: process.cwd(),
});

process.exit(r.status ?? 1);
