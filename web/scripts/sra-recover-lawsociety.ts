/**
 * Recover SRA organisation names via Law Society Find a Solicitor (SRA ID search).
 *
 * Usage:
 *   npm run sra:recover:lawsociety -- --limit=100
 *   npm run sra:recover:lawsociety -- --resume
 *   npm run sra:recover:lawsociety -- --sra=1002231
 *   npm run sra:recover:lawsociety -- --slow --limit=20
 *   npm run sra:recover:lawsociety -- --batch-size=3 --delay-ms=90000 --batch-pause-ms=300000
 */
import "./load-dotenv";

import { prisma } from "../lib/db/prisma";
import { runLawSocietySraRecovery } from "../lib/sra/law-society-sra-recovery-run";
import { parseCliLimit } from "../lib/provider-enrichment-ladder/ladder-cli";

function parseSra(argv: string[]): string | undefined {
  const flag = argv.find((a) => a.startsWith("--sra="));
  if (flag) return flag.split("=")[1]?.trim();
  const idx = argv.indexOf("--sra");
  if (idx >= 0 && argv[idx + 1]) return argv[idx + 1]!.trim();
  return undefined;
}

function parseMs(argv: string[], flag: string): number | undefined {
  const f = argv.find((a) => a.startsWith(`${flag}=`));
  if (!f) return undefined;
  const n = Number(f.split("=")[1]);
  return Number.isFinite(n) ? n : undefined;
}

async function main() {
  const argv = process.argv;
  const slow = argv.includes("--slow");

  const result = await runLawSocietySraRecovery(prisma, {
    limit: parseCliLimit(argv, slow ? 20 : 100),
    dryRun: argv.includes("--dry-run"),
    resume: argv.includes("--resume"),
    debug: argv.includes("--debug"),
    sraId: parseSra(argv),
    slow,
    delayBetweenMs: parseMs(argv, "--delay-ms"),
    batchSize: parseMs(argv, "--batch-size"),
    batchPauseMs: parseMs(argv, "--batch-pause-ms"),
    onlyPlaceholders: !argv.includes("--all"),
  });

  console.info(JSON.stringify(result, null, 2));
  process.exitCode =
    result.failed > result.scanned / 2 && result.recovered === 0 ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
