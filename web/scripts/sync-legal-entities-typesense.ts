/**
 * Index all legal entities into Typesense `legal_entities` collection.
 * Usage: tsx scripts/sync-legal-entities-typesense.ts [curated|legal_aid|lawyers|sra|probono|all]
 */
import "./load-dotenv";
import { syncLegalEntitiesToTypesense } from "../lib/search-index/sync-typesense";
import type { IndexSource } from "../lib/search-index/types";

const arg = (process.argv[2] || "all").toLowerCase();
const source = (
  ["curated", "legal_aid", "lawyers", "sra", "probono", "all"].includes(arg) ? arg : "all"
) as IndexSource;

syncLegalEntitiesToTypesense(source)
  .then((s) => {
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
