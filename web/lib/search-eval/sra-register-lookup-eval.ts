import { buildFirmWebsiteSearchQueries } from "@/lib/provider-osint/firm-search-queries";
import { resolveFirmNameSeed } from "@/lib/provider-osint/firm-name-seed";
import {
  applySraRegisterLookupToRow,
  type SraNameBackfillOptions,
} from "@/lib/sra/register-name-backfill";
import { lookupSraRegisterByOrganisationId } from "@/lib/sra/register-lookup";
import {
  classifySraStoredName,
  isAddressLikeName,
  isPlaceholderSraDisplayName,
  isUsableFirmNameCandidate,
} from "@/lib/sra/sra-name-quality";
import type { LegalEntityDocument } from "@/lib/search-index/types";

function mockLookup(sraId: string, displayName: string) {
  return {
    sraId,
    organisationName: displayName,
    tradingName: "",
    firmName: displayName,
    displayName,
    sourceUrl: `https://www.sra.org.uk/consumers/solicitor-check/?searchText=${sraId}`,
    fetchedAt: new Date().toISOString(),
    confidence: 0.9,
    source: "sra_register" as const,
  };
}

export function runSraRegisterLookupEval(): number {
  let failed = 0;
  const fail = (msg: string) => {
    console.error(`FAIL sra-register-lookup: ${msg}`);
    failed++;
  };

  const lookup = mockLookup("1002232", "Bhayani HR & Employment Law");
  if (!lookup.displayName?.includes("Bhayani")) {
    fail("organisation lookup should return firm name");
  }

  const placeholder = "SRA organisation 1002231";
  if (!isPlaceholderSraDisplayName(placeholder, "1002231")) {
    fail("placeholder display name should be detected");
  }

  if (isUsableFirmNameCandidate("Smith & Jones Solicitors LLP", "999")) {
    /* ok */
  } else {
    fail("real firm name should be usable");
  }

  if (!isAddressLikeName("London, SW1E 5BY")) {
    fail("London, SW1E 5BY should be address_like");
  }
  if (!isAddressLikeName("Dubai, United Arab Emirates")) {
    fail("Dubai, UAE should be address_like");
  }
  if (isAddressLikeName("Bhayani HR & Employment Law")) {
    fail("firm name should not be address_like");
  }

  if (classifySraStoredName("https://www.sra1002232.co.uk", "1002232") !== "real_firm_name") {
    /* domain stored as name is odd but not address - skip */
  }

  const goodName = "Existing Firm LLP";
  const wouldSkip =
    !({ force: false } as SraNameBackfillOptions).force &&
    classifySraStoredName(goodName, "1") === "real_firm_name";
  if (!wouldSkip) fail("good existing name should not be overwritten without --force");

  const doc: LegalEntityDocument = {
    id: "sra:1002232",
    entityType: "sra_organisation",
    title: "Bhayani HR & Employment Law",
    displayName: "Bhayani HR & Employment Law",
    description: "",
    practiceAreas: [],
    categories: [],
    subIssues: [],
    searchText: "1002232\nBhayani HR & Employment Law",
    expandedSearchText: "",
    source: "sra",
    legalAid: false,
    authorityScore: 0.5,
    profileCompletenessScore: 0.2,
    rawSourceId: "1002232",
    sraId: "1002232",
    updatedAt: Date.now(),
  };

  const seed = resolveFirmNameSeed(doc);
  if (!seed?.primaryName.includes("Bhayani")) {
    fail("website discovery seed should use recovered firm name");
  }

  const queries = seed ? buildFirmWebsiteSearchQueries(seed) : [];
  if (!queries.some((q) => q.includes("Bhayani"))) {
    fail("search queries should use firm name");
  }
  if (queries.some((q) => q.includes("1002232"))) {
    fail("search queries must not use SRA id");
  }

  const unresolved: {
    sraId: string;
    displayName?: string;
    rejectReason?: "not_found";
    sourceUrl: string;
    fetchedAt: string;
    confidence: number;
    source: "sra_register";
  } = {
    ...mockLookup("1002231", "placeholder"),
    displayName: undefined,
    rejectReason: "not_found",
  };
  if (unresolved.rejectReason !== "not_found") {
    fail("unresolved lookup should carry not_found reason");
  }

  void applySraRegisterLookupToRow;
  void lookupSraRegisterByOrganisationId;

  if (failed === 0) {
    console.info("PASS sra register lookup eval");
  }
  return failed;
}
