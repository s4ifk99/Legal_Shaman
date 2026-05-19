/**
 * Verify Typesense legal_entities index integrity.
 * Run: cd web && npm run search:index:verify
 */
import "./load-dotenv";
import {
  formatVerifyReportTable,
  verifyLegalEntitiesIndex,
} from "../lib/search-index/verify-index";

async function main() {
  const report = await verifyLegalEntitiesIndex();
  console.log(formatVerifyReportTable(report));
  process.exit(report.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
