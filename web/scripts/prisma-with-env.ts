/**
 * Run Prisma CLI after loading `.env` / `.env.local` (same as sra:sync).
 * Usage: tsx scripts/prisma-with-env.ts migrate deploy
 */
import "./load-dotenv";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: tsx scripts/prisma-with-env.ts <prisma args…>");
  console.error('Example: tsx scripts/prisma-with-env.ts migrate deploy');
  process.exit(1);
}

const prismaBin = resolve(process.cwd(), "node_modules", ".bin", "prisma");
const r = spawnSync(prismaBin, args, {
  stdio: "inherit",
  env: process.env,
  cwd: process.cwd(),
});

process.exit(r.status ?? 1);
