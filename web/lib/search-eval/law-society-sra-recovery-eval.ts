import {
  filterLawSocietyRows,
  lawSocietyResultToRegisterLookup,
  scoreLawSocietyMatch,
} from "@/lib/sra/law-society-sra-recovery";
import {
  parseLawSocietyProfileHtml,
  parseLawSocietySearchResultsHtml,
  postcodesMatch,
} from "@/lib/sra/law-society-parse";
import { lawSocietySearchUrlForSraId } from "@/lib/sra/law-society-sra-recovery";

const SEARCH_921469 = `
<article class="search-result">
  <h2><a href="https://solicitors.lawsociety.org.uk/organisation/12345/bhayani">Bhayani HR &amp; Employment Law</a></h2>
  <p>SRA number: 921469</p>
  <p>1 High Street, Sheffield, S1 4SB</p>
  <a href="https://solicitors.lawsociety.org.uk/organisation/12345/bhayani">View profile</a>
</article>
`;

const PROFILE_921469 = `
<h1>Bhayani HR &amp; Employment Law</h1>
<p>SRA ID: 921469</p>
<p>Address: Sheffield, S1 4SB</p>
<p>Tel: 0114 123 4567</p>
<a href="https://www.bhayani.co.uk">Website</a>
<p>Areas of practice: Employment law, HR</p>
`;

const SEARCH_MULTIPLE = `
<article class="search-result"><h2>Firm A</h2><p>SRA number: 1002231</p>
<a href="https://solicitors.lawsociety.org.uk/organisation/1/a">A</a></article>
<article class="search-result"><h2>Firm B</h2><p>SRA number: 1002231</p>
<a href="https://solicitors.lawsociety.org.uk/organisation/2/b">B</a></article>
`;

export function runLawSocietySraRecoveryEval(): number {
  let failed = 0;
  const fail = (msg: string) => {
    console.error(`FAIL law-society-sra-recovery: ${msg}`);
    failed++;
  };

  const rows921469 = parseLawSocietySearchResultsHtml(SEARCH_921469, "921469");
  if (!rows921469.some((r) => r.organisationName.includes("Bhayani"))) {
    fail("921469 search HTML should parse Bhayani");
  }

  const scored921469 = scoreLawSocietyMatch({
    targetSraId: "921469",
    rows: rows921469,
    profileRow: parseLawSocietyProfileHtml(PROFILE_921469),
  });
  if (!scored921469 || scored921469.confidence < 0.99) {
    fail("921469 should score 0.99 exact SRA profile match");
  } else if (!scored921469.organisationName.includes("Bhayani")) {
    fail("921469 organisation name");
  } else {
  const mapped = lawSocietyResultToRegisterLookup(scored921469);
  if (mapped.source !== "law_society_sra_lookup") {
    fail("provenance should be law_society_sra_lookup");
  }
  if (!mapped.website?.includes("bhayani")) {
    fail("921469 website extraction");
  }
  if (!mapped.phone?.includes("0114")) {
    fail("921469 phone extraction");
  }
  }

  const rows1002231 = parseLawSocietySearchResultsHtml("", "1002231");
  if (rows1002231.length !== 0) {
    fail("empty search should yield no rows for 1002231");
  }

  const multi = scoreLawSocietyMatch({
    targetSraId: "1002231",
    rows: parseLawSocietySearchResultsHtml(SEARCH_MULTIPLE, "1002231"),
  });
  if (!multi || multi.matchKind !== "multiple") {
    fail("ambiguous multiple results should be marked multiple");
  }

  if (!postcodesMatch("Sheffield S1 4SB", "S1 4SB")) {
    fail("postcode verification helper");
  }

  const url = lawSocietySearchUrlForSraId("921469");
  if (!url.includes("Name=921469") || !url.includes("Type=0")) {
    fail("search URL should use Name= (not Term=) and organisation Type=0");
  }
  if (url.includes("Term=")) {
    fail("search URL must not use deprecated Term= parameter");
  }

  const noisy = filterLawSocietyRows(
    [
      {
        organisationName: "5 solicitors",
        profileUrl: "https://solicitors.lawsociety.org.uk/organisation/people/1/x",
        practiceAreas: [],
        solicitors: [],
      },
      {
        organisationName: "Bhayani Law Limited",
        profileUrl: "https://solicitors.lawsociety.org.uk/office/564069/bhayani-law-limited",
        sraIdOnPage: "921469",
        practiceAreas: [],
        solicitors: [],
      },
    ],
    "921469",
  );
  if (noisy.length !== 1 || !noisy[0]!.organisationName.includes("Bhayani")) {
    fail("filterLawSocietyRows should drop solicitor-count links");
  }

  if (failed === 0) {
    console.info("PASS law society SRA recovery eval");
  }
  return failed;
}
