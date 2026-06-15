import {
  projectSraPracticeAreas,
  applySraPracticeAreaProjection,
} from "@/lib/sra/practice-area-projection";
import { collectIndexBalanceReport } from "@/lib/search-index/index-balance-diagnostics";
import type { LegalEntityDocument } from "@/lib/search-index/types";

function baseSraDoc(over: Partial<LegalEntityDocument>): LegalEntityDocument {
  return {
    id: "sra:test",
    entityType: "sra_organisation",
    title: "Test LLP",
    description: "",
    practiceAreas: [],
    categories: ["SRA organisation"],
    subIssues: [],
    searchText: "",
    expandedSearchText: "",
    source: "sra",
    legalAid: false,
    authorityScore: 0.78,
    profileCompletenessScore: 0.5,
    rawSourceId: "1",
    updatedAt: Date.now(),
    ...over,
  };
}

function expectEmployment(
  label: string,
  input: Parameters<typeof projectSraPracticeAreas>[0],
  fail: (msg: string) => void,
): void {
  const result = projectSraPracticeAreas(input);
  if (!result.practiceAreaSlugs.includes("employment")) {
    fail(`${label} should project employment`);
  }
}

function expectNotEmployment(
  label: string,
  input: Parameters<typeof projectSraPracticeAreas>[0],
  fail: (msg: string) => void,
): void {
  const result = projectSraPracticeAreas(input);
  if (result.practiceAreaSlugs.includes("employment")) {
    fail(`${label} must not project employment`);
  }
}

export function runSraPracticeAreaProjectionEval(): number {
  let failed = 0;
  const fail = (msg: string) => {
    console.error(`FAIL sra-projection: ${msg}`);
    failed++;
  };

  const family = projectSraPracticeAreas({
    organisationName: "Jones Family Law LLP",
    descriptionText: "Divorce, child arrangements, matrimonial finance and domestic abuse",
    serviceText: "Family mediation and separation agreements",
  });
  if (!family.practiceAreaSlugs.includes("family")) {
    fail("divorce/family text should project family slug");
  }
  if (family.confidence < 0.5) fail("family projection confidence too low");
  if (family.matchedSignals.length < 2) fail("expected multiple matched signals");

  const education = projectSraPracticeAreas({
    organisationName: "Education Advocates",
    descriptionText: "SEND tribunal and school exclusion appeals",
  });
  if (!education.practiceAreaSlugs.includes("education")) {
    fail("SEND/school exclusion should project education");
  }

  expectEmployment(
    "unfair dismissal",
    {
      organisationName: "Work Rights Solicitors",
      descriptionText: "Unfair dismissal and employment tribunal representation",
    },
    fail,
  );

  expectEmployment(
    "redundancy",
    { organisationName: "Redundancy Legal", descriptionText: "Redundancy advice and settlement agreements" },
    fail,
  );

  expectEmployment(
    "employment tribunal",
    {
      organisationName: "Tribunal Advocates",
      descriptionText: "Employment tribunal claims and ET1 preparation",
    },
    fail,
  );

  expectEmployment("TUPE", { organisationName: "Transfer Law", descriptionText: "TUPE transfers and consultation" }, fail);

  expectEmployment(
    "workplace discrimination",
    {
      organisationName: "Equality at Work LLP",
      descriptionText: "Workplace discrimination and harassment claims",
    },
    fail,
  );

  const employmentMulti = projectSraPracticeAreas({
    organisationName: "Employment Team",
    descriptionText: "Unfair dismissal, redundancy packages, whistleblowing",
  });
  if (!employmentMulti.practiceAreaSlugs.includes("employment")) {
    fail("multiple employment phrases should project employment");
  }
  if ((employmentMulti.employmentProjectionConfidence ?? 0) < 0.5) {
    fail("employment projection confidence too low for corroborated signals");
  }

  const enrichmentEmployment = projectSraPracticeAreas({
    organisationName: "Enriched Firm",
    descriptionText: "General advisory services",
    enrichmentText: "tribunal.employment employment tribunal",
    approvedCapabilities: ["tribunal.employment"],
    enrichmentApproved: true,
  });
  if (!enrichmentEmployment.practiceAreaSlugs.includes("employment")) {
    fail("approved enrichment tribunal.employment should project employment");
  }

  expectNotEmployment(
    "commercial litigation only",
    {
      organisationName: "City Litigation LLP",
      descriptionText: "Commercial litigation, contract disputes and banking disputes",
      serviceText: "Business and corporate advisory",
    },
    fail,
  );

  const generic = projectSraPracticeAreas({
    organisationName: "ABC Legal Services",
    descriptionText: "General commercial and property advice",
  });
  if (generic.practiceAreaSlugs.includes("family")) {
    fail("generic commercial text must not project family");
  }
  if (generic.practiceAreaSlugs.includes("employment")) {
    fail("generic commercial text must not project employment");
  }

  const doc = applySraPracticeAreaProjection(
    baseSraDoc({
      title: "Manchester Divorce Solicitors",
      searchText: "Private divorce solicitor Manchester family law",
      expandedSearchText: "Private divorce solicitor Manchester",
    }),
    family,
  );
  if (!doc.practiceAreaSlugs?.includes("family")) {
    fail("applySraPracticeAreaProjection should set practiceAreaSlugs");
  }
  if (!doc.expandedSearchText.toLowerCase().includes("family")) {
    fail("expandedSearchText should include family aliases");
  }

  const employmentDoc = applySraPracticeAreaProjection(
    baseSraDoc({
      title: "Employment Law Partners",
      searchText: "Employment law unfair dismissal London",
      expandedSearchText: "Employment law unfair dismissal",
    }),
    employmentMulti,
  );
  if (!employmentDoc.expandedSearchText.toLowerCase().includes("employment")) {
    fail("expandedSearchText should include employment aliases");
  }

  if (failed === 0) console.info("sra practice-area projection eval OK");
  return failed;
}

/** Live-index regression: requires Typesense + completed SRA reindex. */
export async function runEmploymentSraCountRegressionEval(): Promise<number> {
  if (process.env.SKIP_EMPLOYMENT_INDEX_REGRESSION === "1") return 0;
  const balance = await collectIndexBalanceReport();
  if (!balance) {
    console.error("FAIL employment-index-regression: could not collect index balance");
    return 1;
  }
  const count = balance.sraByPracticeAreaSlug.employment ?? 0;
  if (count === 0) {
    console.error(
      `FAIL employment-index-regression: employment_sra_count=0 (re-run npm run search:index:sra)`,
    );
    return 1;
  }
  if (count <= 100) {
    console.warn(
      `WARN employment-index-regression: employment_sra_count=${count} (target >100; ~28 firms in SRA search_text — re-sync PracticeAreas to grow)`,
    );
    return 0;
  }
  console.info(`employment-index-regression OK: employment_sra_count=${count}`);
  return 0;
}
