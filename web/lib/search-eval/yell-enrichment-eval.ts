import { validateIdentityCandidate } from "@/lib/sra/missing-identity-recovery/candidate-validator";
import { shouldRunYellIdentityRecovery } from "@/lib/sra/missing-identity-recovery/orchestrator";
import { rejectCandidateName } from "@/lib/sra/missing-identity-recovery/candidate-name-rejection";
import {
  scoreYellFirmNameMatch,
  validateYellListingForEnrichment,
} from "@/lib/provider-enrichment/yell-listings";

export async function runYellEnrichmentEval(): Promise<number> {
  let failed = 0;
  const fail = (msg: string) => {
    console.error(`FAIL yell-enrichment: ${msg}`);
    failed++;
  };

  const nearMe = "Solicitors Near Me in Haxby";
  if (!rejectCandidateName(nearMe, { sourceType: "yell", sourceUrl: "https://yell.com/search" }).rejected) {
    fail("near me Yell heading should be rejected");
  }

  const hair = "Hair At No 43";
  if (!rejectCandidateName(hair, { sourceType: "yell", sourceUrl: "https://yell.com/biz/hair" }).rejected) {
    fail("Hair At No 43 should be rejected");
  }

  const wareKayMatch = scoreYellFirmNameMatch("Ware & Kay Solicitors", "Ware & Kay");
  if (!wareKayMatch.strong) {
    fail("Ware & Kay should strongly match approved firm Ware & Kay Solicitors");
  }

  const wareKayGate = validateYellListingForEnrichment(
    {
      businessName: "Ware & Kay",
      profileUrl: "https://www.yell.com/biz/ware-and-kay-solicitors",
      address: "1 High Street, Ware SG12 9BA",
      categories: "solicitors",
      phone: "01920 000000",
    },
    "Ware & Kay Solicitors",
    "SG12 9BA",
  );
  if (!wareKayGate.ok) {
    fail(`Ware & Kay listing should pass enrichment gate: ${!wareKayGate.ok ? wareKayGate.reason : ""}`);
  }

  const phoneGate = validateYellListingForEnrichment(
    {
      businessName: "Town Centre Solicitors LLP",
      profileUrl: "https://www.yell.com/biz/town-centre",
      address: "12 High St Sheffield S1 4SB",
      categories: "solicitors",
      phone: "0114 1234567",
    },
    "Town Centre Solicitors LLP",
    "S1 4SB",
  );
  if (!phoneGate.ok) {
    fail("firm name + postcode match should accept Yell phone listing");
  }

  if (shouldRunYellIdentityRecovery({})) {
    fail("Yell identity recovery should be off by default");
  }
  if (!shouldRunYellIdentityRecovery({ includeYellIdentity: true })) {
    fail("Yell identity recovery should run when --include-yell-identity");
  }

  const yellIdentity = validateIdentityCandidate(
    {
      sraId: "100",
      candidateName: "Solicitors Near Me in Standon",
      sourceType: "yell",
      sourceUrl: "https://yell.com/search",
      evidenceText: "solicitors",
      confidence: 0.9,
    },
    "100",
  );
  if (yellIdentity.ok) {
    fail("Yell near-me should not validate as SRA identity candidate");
  }

  if (failed === 0) {
    console.info("PASS yell-enrichment eval");
  }
  return failed;
}
