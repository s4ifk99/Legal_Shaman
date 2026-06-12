/**
 * Index all legal entities into Typesense `legal_entities` collection.
 * Usage: tsx scripts/sync-legal-entities-typesense.ts [curated|legal_aid|lawyers|sra|probono|all]
 * SRA: --limit=1000 --resume-after=<sraId>
 */
import "./load-dotenv";
import { syncLegalEntitiesToTypesense } from "../lib/search-index/sync-typesense";
import type { IndexSource } from "../lib/search-index/types";

function parseFlagValue(name: string): string | undefined {
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.split("=")[1];
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && process.argv[idx + 1] && !process.argv[idx + 1]!.startsWith("--")) {
    return process.argv[idx + 1];
  }
  return undefined;
}

const arg = (process.argv[2] || "all").toLowerCase();
const source = (
  ["curated", "legal_aid", "lawyers", "sra", "probono", "all"].includes(arg) ? arg : "all"
) as IndexSource;

const limitRaw = parseFlagValue("limit");
const limit = limitRaw ? Number(limitRaw) : undefined;
const resumeAfter = parseFlagValue("resume-after");

if (limitRaw && (!Number.isFinite(limit) || limit! <= 0)) {
  console.error("--limit must be a positive number");
  process.exit(1);
}

syncLegalEntitiesToTypesense(source, { limit, resumeAfter })
  .then((s) => {
    if (s.degraded) {
      console.error(
        JSON.stringify({
          event: "search_index_sra_degraded",
          degraded: true,
          resumeAfter: s.resumeAfter ?? null,
        }),
      );
      process.exit(1);
    }
    if (s.errors.length) {
      console.error("Errors:", s.errors);
      process.exit(1);
    }
    console.log("Done:", s);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
