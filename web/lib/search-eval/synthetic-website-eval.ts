import {
  isObviouslySyntheticGeneratedUrl,
  isSyntheticGeneratedDomain,
  isSyntheticWebsiteDomain,
} from "@/lib/provider-osint/synthetic-domain";
import { discoverWebsiteFromFirmNameHeuristic } from "@/lib/provider-osint/search-website-discovery";
import { candidateMayEnterModeration } from "@/lib/provider-osint/website-candidate-types";

const EXACT_BAD_URLS = [
  "https://www.dubaiunitedarabemirates.co.uk",
  "https://www.nairobikenya.co.uk",
  "https://www.londonsw1p3js.co.uk",
  "https://www.londonsw1e5by.co.uk",
  "https://www.abudhabiunitedarabemirates.co.uk",
  "https://www.piraeus185greece.co.uk",
  "https://www.sra1002232.co.uk",
] as const;

export function runSyntheticWebsiteEval(): number {
  let failed = 0;
  const fail = (msg: string) => {
    console.error(`FAIL synthetic-website: ${msg}`);
    failed++;
  };

  for (const url of EXACT_BAD_URLS) {
    if (!isObviouslySyntheticGeneratedUrl(url).synthetic) {
      fail(`known bad URL must be synthetic: ${url}`);
    }
    const withCtx = isSyntheticGeneratedDomain(url, {
      firmName: "Example Solicitors LLP",
      sraId: "1002232",
      postcode: "SW1E 5BY",
      city: "London",
    });
    if (!withCtx.synthetic) {
      fail(`known bad URL must be synthetic with context: ${url}`);
    }
  }

  const firmDomain = isSyntheticWebsiteDomain(
    "https://www.smithjones-solicitors.co.uk",
    "Smith & Jones Solicitors LLP",
  );
  if (firmDomain.synthetic) {
    fail("real firm-name domain should not be synthetic");
  }

  if (discoverWebsiteFromFirmNameHeuristic({} as never) !== null) {
    fail("heuristic domain guess must never return a candidate");
  }

  if (candidateMayEnterModeration("heuristic_guess", 0.99)) {
    fail("heuristic_guess must not enter moderation");
  }

  if (failed === 0) {
    console.info("PASS synthetic-website eval");
  }
  return failed;
}
