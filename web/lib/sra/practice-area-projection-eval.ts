import {
  projectSraPracticeAreas,
  applySraPracticeAreaProjection,
} from "@/lib/sra/practice-area-projection";
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

  const employment = projectSraPracticeAreas({
    organisationName: "Work Rights Solicitors",
    descriptionText: "Unfair dismissal and employment tribunal representation",
  });
  if (!employment.practiceAreaSlugs.includes("employment")) {
    fail("unfair dismissal should project employment");
  }

  const generic = projectSraPracticeAreas({
    organisationName: "ABC Legal Services",
    descriptionText: "General commercial and property advice",
  });
  if (generic.practiceAreaSlugs.includes("family")) {
    fail("generic commercial text must not project family");
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

  if (failed === 0) console.info("sra practice-area projection eval OK");
  return failed;
}
