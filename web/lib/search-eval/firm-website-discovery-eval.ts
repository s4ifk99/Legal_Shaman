import { buildFirmWebsiteSearchQueries } from "@/lib/provider-osint/firm-search-queries";
import {
  firmNameLooksLikeSraId,
  resolveFirmNameSeed,
  type FirmNameSeed,
} from "@/lib/provider-osint/firm-name-seed";
import {
  INVALID_FIRM_NAME_SEED_REASON,
  isValidFirmNameSeed,
  rejectFirmNameSeed,
} from "@/lib/provider-osint/firm-name-seed-validation";
import { planFirmWebSearchProvider } from "@/lib/provider-osint/firm-web-search";
import { scoreSearchResultCandidate } from "@/lib/provider-osint/website-candidate-evidence";
import { isSerperApiConfigured } from "@/lib/search/serper-client";
import { discoverWebsiteFromFirmNameHeuristic } from "@/lib/provider-osint/search-website-discovery";
import {
  isObviouslySyntheticGeneratedUrl,
  isSyntheticWebsiteDomain,
} from "@/lib/provider-osint/synthetic-domain";
import { candidateMayEnterModeration } from "@/lib/provider-osint/website-candidate-types";
import { isRegulatoryOrDirectoryUrl } from "@/lib/provider-enrichment/regulatory-url-filter";
import type { LegalEntityDocument } from "@/lib/search-index/types";

function minimalDoc(overrides: Partial<LegalEntityDocument> = {}): LegalEntityDocument {
  return {
    id: "sra:1002232",
    entityType: "sra_organisation",
    title: "Bhayani HR & Employment Law",
    displayName: "Bhayani HR & Employment Law",
    organisationName: "Bhayani Law Limited",
    description: "",
    practiceAreas: [],
    categories: [],
    subIssues: [],
    searchText: "1002232\nBhayani HR & Employment Law\nSheffield",
    expandedSearchText: "",
    source: "sra",
    legalAid: false,
    authorityScore: 0.78,
    profileCompletenessScore: 0.2,
    rawSourceId: "1002232",
    sraId: "1002232",
    city: "Sheffield",
    postcode: "S1 2BJ",
    updatedAt: Date.now(),
    ...overrides,
  };
}

export function runFirmWebsiteDiscoveryEval(): number {
  let failed = 0;
  const fail = (msg: string) => {
    console.error(`FAIL firm-website-discovery: ${msg}`);
    failed++;
  };

  const doc = minimalDoc();
  const seed = resolveFirmNameSeed(doc);
  if (!seed || seed.primaryName !== "Bhayani HR & Employment Law") {
    fail("firm name seed should use display name from Postgres fields");
  }

  const queries = seed ? buildFirmWebsiteSearchQueries(seed) : [];
  if (!queries.some((q) => q.includes("Bhayani HR & Employment Law") && q.includes("solicitors"))) {
    fail("search queries must use firm name, not SRA id");
  }
  if (queries.some((q) => q.includes("1002232") || q.includes("sra:1002232"))) {
    fail("search queries must never include SRA id");
  }
  if (queries.some((q) => /s1\s*2bj/i.test(q) && !q.includes("Bhayani"))) {
    fail("postcode must not appear without firm name in query");
  }

  if (!firmNameLooksLikeSraId("1002232", "1002232")) {
    fail("SRA id should be detected as invalid firm name");
  }

  const badUrls = [
    "https://www.dubaiunitedarabemirates.co.uk",
    "https://www.nairobikenya.co.uk",
    "https://www.londonsw1p3js.co.uk",
    "https://www.londonsw1e5by.co.uk",
    "https://www.abudhabiunitedarabemirates.co.uk",
    "https://www.piraeus185greece.co.uk",
    "https://www.sra1002232.co.uk",
  ];
  for (const url of badUrls) {
    if (!isObviouslySyntheticGeneratedUrl(url).synthetic) {
      fail(`production bad URL must be synthetic: ${url}`);
    }
  }

  const synthetic = isSyntheticWebsiteDomain("https://www.sra1002232.co.uk", "Bhayani HR & Employment Law", {
    sraId: "1002232",
  });
  if (!synthetic.synthetic) {
    fail("sra1002232.co.uk must be rejected as synthetic");
  }

  const postcodeDomain = isSyntheticWebsiteDomain(
    "https://www.londonsw1e5by.co.uk",
    "Example Solicitors LLP",
    { postcode: "SW1E 5BY", city: "London" },
  );
  if (!postcodeDomain.synthetic) {
    fail("postcode-compact domain must be rejected");
  }

  if (isRegulatoryOrDirectoryUrl("https://www.sra.org.uk")) {
    /* ok */
  } else {
    fail("sra.org.uk should be regulatory");
  }

  const firmDomain = isSyntheticWebsiteDomain(
    "https://www.smithjones-solicitors.co.uk",
    "Smith & Jones Solicitors LLP",
  );
  if (firmDomain.synthetic) {
    fail("real firm-name domain should not be synthetic");
  }

  if (discoverWebsiteFromFirmNameHeuristic(doc) !== null) {
    fail("heuristic domain guess must never return a candidate");
  }

  if (candidateMayEnterModeration("heuristic_guess", 0.99)) {
    fail("heuristic_guess must not enter moderation");
  }
  if (!candidateMayEnterModeration("registry_supplied", 0.8)) {
    fail("registry_supplied should enter moderation");
  }
  if (!candidateMayEnterModeration("search_result", 0.8)) {
    fail("search_result >= 0.75 should enter moderation");
  }
  if (candidateMayEnterModeration("search_result", 0.5)) {
    fail("low-confidence search_result must not enter moderation");
  }

  const badNewsDoc = minimalDoc({
    id: "sra:1002232",
    displayName: "Legal News > Your source for information behind the law",
    title: "Legal News > Your source for information behind the law",
    organisationName: "Legal News > Your source for information behind the law",
    firmName: undefined,
    searchText: "1002232\nLegal News > Your source for information behind the law",
    sraId: "1002232",
  });
  const badNewsSeed = resolveFirmNameSeed(badNewsDoc);
  if (badNewsSeed) {
    fail("article/news display name must not produce firm name seed");
  }
  if (buildFirmWebsiteSearchQueries({
    primaryName: "Legal News > Your source for information behind the law",
    nameSources: [],
    sraId: "1002232",
  }).length > 0) {
    fail("bad recovered name must not generate website query");
  }

  const addressDoc = minimalDoc({
    id: "sra:1002234",
    displayName: "ABU DHABI, United Arab Emirates",
    title: "ABU DHABI, United Arab Emirates",
    organisationName: "ABU DHABI, United Arab Emirates",
    firmName: undefined,
    searchText: "1002234\nABU DHABI, United Arab Emirates",
    sraId: "1002234",
  });
  if (resolveFirmNameSeed(addressDoc)) {
    fail("address-like displayName must not produce firm name seed");
  }
  if (
    buildFirmWebsiteSearchQueries({
      primaryName: "ABU DHABI, United Arab Emirates",
      nameSources: [],
      sraId: "1002234",
    }).length > 0
  ) {
    fail("address-like displayName must not generate website query");
  }

  const legalNewsScored = scoreSearchResultCandidate(
    {
      url: "https://www.legalnews.com",
      title: "Legal News",
      snippet: "",
      query: "test",
    },
    {
      primaryName: "Legal News > Your source for information behind the law",
      nameSources: [],
      sraId: "1002232",
    },
  );
  if (legalNewsScored?.mayPersist) {
    fail("legalnews.com must be rejected when firm seed is invalid");
  }
  if (legalNewsScored?.rejectReason !== INVALID_FIRM_NAME_SEED_REASON) {
    fail(`legalnews.com reject reason expected ${INVALID_FIRM_NAME_SEED_REASON}`);
  }

  if (!isValidFirmNameSeed("Dr Sonia Khan Solicitors", "1004306")) {
    fail("valid firm name should pass seed validation");
  }
  const validSeed: FirmNameSeed = {
    primaryName: "Dr Sonia Khan Solicitors",
    nameSources: ["Dr Sonia Khan Solicitors"],
    sraId: "1004306",
    city: "London",
  };
  const validQueries = buildFirmWebsiteSearchQueries(validSeed);
  if (!validQueries.some((q) => q.includes("Dr Sonia Khan Solicitors"))) {
    fail("valid firm name should build search queries");
  }
  if (rejectFirmNameSeed("SRA organisation 1002231", "1002231").valid) {
    fail("placeholder SRA organisation name must be rejected");
  }

  const providerPlan = planFirmWebSearchProvider();
  if (providerPlan.apiConfigured !== isSerperApiConfigured()) {
    fail("planFirmWebSearchProvider apiConfigured must match isSerperApiConfigured");
  }
  if (isSerperApiConfigured() && providerPlan.primary !== "serper") {
    fail("website discovery should use Serper when API key is configured");
  }
  if (!isSerperApiConfigured() && providerPlan.primary !== "duckduckgo") {
    fail("website discovery should fall back to DuckDuckGo without Serper key");
  }

  if (failed === 0) {
    console.info("PASS firm website discovery eval");
  }
  return failed;
}
