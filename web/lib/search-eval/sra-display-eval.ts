import type { SearchResult } from "@/lib/legal-search/types";
import {
  enrichSearchResultForPublic,
  phoneForDisplay,
  publicResultTitle,
} from "@/lib/legal-search/public-search-result";
import { buildMapMarkers } from "@/lib/search/map-results";
import { emptyScores } from "@/lib/legal-search/ranking";
import { sanitiseContactForDisplay } from "@/lib/provider-intelligence/provider-capability-ranker";
import {
  extractFirmNameFromSraSearchText,
  isPlaceholderSraBusinessName,
  resolveSraDisplayName,
} from "@/lib/search/sra-display";
import {
  isSraPlaceholderTitle,
  repairSraSearchResults,
} from "@/lib/sra/runtime-name-repair";

function mockSraResult(over: Partial<SearchResult> = {}): SearchResult {
  return {
    id: "sra:921469",
    source: "sra",
    title: "Organisation 921469",
    practiceAreas: ["Employment Law"],
    categories: ["SRA organisation"],
    location: { city: "Sheffield", postcode: "S1 2BJ", lat: 53.38, lng: -1.47 },
    contact: { phone: "+442011112222", website: "https://example.com" },
    raw: {
      entityType: "sra_organisation",
      sraId: "921469",
      searchText: "921469\nBhayani HR & Employment Law\nSHEFFIELD",
      enrichmentStatus: "approved",
      contactSource: "sra_register",
    },
    scores: emptyScores({ final: 0.5 }),
    explanation: "Matches Employment Law and your search terms.",
    ...over,
  };
}

export async function runSraDisplayEval(): Promise<number> {
  let failed = 0;
  const fail = (msg: string) => {
    console.error(`FAIL sra-display: ${msg}`);
    failed++;
  };

  const resolved = resolveSraDisplayName(
    "Organisation 921469",
    "921469\nBhayani HR & Employment Law\nSHEFFIELD",
    "921469",
    { organisationName: "Bhayani HR & Employment Law Ltd" },
  );
  if (resolved !== "Bhayani HR & Employment Law Ltd") {
    fail(`organisationName priority got "${resolved}"`);
  }

  const fromText = resolveSraDisplayName("Organisation 921469", "921469\nAcme LLP\nLondon", "99");
  if (fromText !== "Acme LLP") fail(`searchText extraction got "${fromText}"`);

  if (!isPlaceholderSraBusinessName("Organisation 921469", "921469")) {
    fail("placeholder detection for Organisation <id>");
  }

  const noPlaceholderWhenNamed = resolveSraDisplayName(
    "Smith & Co Solicitors",
    "",
    "123",
  );
  if (noPlaceholderWhenNamed.includes("Organisation 123")) {
    fail("named firm should not become Organisation <id>");
  }

  const approved = enrichSearchResultForPublic(
    sanitiseContactForDisplay(
      mockSraResult({
        contact: { phone: "+442011112222" },
        raw: {
          enrichmentStatus: "approved",
          contactSource: "sra_register",
          entityType: "sra_organisation",
          sraId: "921469",
          searchText: "921469\nBhayani HR & Employment Law\nSHEFFIELD",
        },
      }),
    ),
  );
  if (!approved.contact?.phone) fail("approved SRA phone should display");
  if (!publicResultTitle(approved).includes("Bhayani")) {
    fail(`public title should resolve firm name, got "${publicResultTitle(approved)}"`);
  }

  const unapproved = enrichSearchResultForPublic(
    sanitiseContactForDisplay(
      mockSraResult({
        contact: { phone: "+442099999999" },
        raw: { enrichmentStatus: "pending_review", contactSource: "crawler", entityType: "sra_organisation", sraId: "921469", searchText: "921469\nBhayani HR\nLondon" },
      }),
    ),
  );
  if (unapproved.contact?.phone) fail("unapproved crawler phone should be hidden");

  const noPhone = enrichSearchResultForPublic(
    mockSraResult({
      contact: {},
      url: "https://www.sra.org.uk/consumers/solicitor-check/?searchText=921469",
      contactPageUrl: "https://www.sra.org.uk/consumers/solicitor-check/?searchText=921469",
    }),
  );
  if (phoneForDisplay(noPhone)) fail("expected no phone");
  if (!noPhone.contactPageUrl?.includes("sra.org.uk")) fail("contact page fallback expected");

  const internalTitle = publicResultTitle(
    mockSraResult({ id: "sra:123", title: "sra:123", source: "sra", raw: { entityType: "sra_organisation", sraId: "123", searchText: "123\nReal Firm\nLondon" } }),
  );
  if (/^sra:/i.test(internalTitle) || internalTitle === "123") {
    fail(`internal id must not be public title: "${internalTitle}"`);
  }

  const markers = buildMapMarkers([approved]);
  if (!markers.markers[0]?.displayName?.includes("Bhayani")) {
    fail("map marker should use resolved displayName");
  }
  if (!markers.markers[0]?.phone) fail("map marker should include phone when approved");

  const extracted = extractFirmNameFromSraSearchText("921469\nTest Firm LLP\nLondon", "921469");
  if (extracted !== "Test Firm LLP") fail(`extractFirmNameFromSraSearchText got "${extracted}"`);

  const placeholder = mockSraResult({ title: "Organisation 921469" });
  const repaired = await repairSraSearchResults([placeholder]);
  const repairedTitle = repaired.results[0]?.title ?? "";
  if (isSraPlaceholderTitle(repairedTitle)) {
    fail(`runtime repair should resolve placeholder, got "${repairedTitle}"`);
  }
  if (!repairedTitle.includes("Bhayani")) {
    fail(`runtime repair expected Bhayani in title, got "${repairedTitle}"`);
  }
  if (repaired.stats.placeholderTitlesResolved < 1) {
    fail("placeholderTitlesResolved metric should be >= 1");
  }
  if (repaired.stats.runtimeTitleResolutionRate < 1) {
    fail("runtimeTitleResolutionRate should be 1 for single placeholder hit");
  }
  if (failed === 0) console.info("PASS sra display eval (names, contact, map, runtime repair)");
  return failed;
}
