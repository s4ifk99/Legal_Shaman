/**
 * Direct SRA Register lookup by organisation number.
 * Usage: npm run sra:lookup -- --id=921469
 */
import "./load-dotenv";

import { lookupSraRegisterWithDiagnostics } from "../lib/sra/register-lookup";
import {
  diagnosticsToJson,
  printLookupDiagnostics,
} from "../lib/sra/register-lookup-diagnostics";

function parseId(argv: string[]): string | null {
  const flag = argv.find((a) => a.startsWith("--id="));
  if (flag) return flag.split("=")[1]?.trim() ?? null;
  const idx = argv.indexOf("--id");
  if (idx >= 0 && argv[idx + 1]) return argv[idx + 1]!.trim();
  return null;
}

async function main() {
  const id = parseId(process.argv);
  if (!id) {
    console.error("Usage: npm run sra:lookup -- --id=921469");
    process.exit(1);
  }

  const diag = await lookupSraRegisterWithDiagnostics(id);
  printLookupDiagnostics(diag);
  console.info(JSON.stringify({ event: "sra_lookup", ...diagnosticsToJson(diag) }, null, 2));

  const ok =
    diag.finalOutcome === "found" &&
    Boolean(diag.result?.displayName) &&
    !diag.result?.rejectReason;
  process.exitCode = ok ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
