import assert from "node:assert/strict";
import {
  curateMatchingProviders,
  matchesDispute,
  parkedOffMatchingHelp,
} from "../lib/coherence/matchingRelevance";

const neighbour = {
  necessitySlug: "neighbour-disputes",
  taxonomySlug: "neighbour_dispute",
  matterType: "housing",
  text: "moved fence into my boundary",
};

const tenancy = {
  necessitySlug: "property-housing",
  taxonomySlug: "landlord_tenant",
  matterType: "housing",
  text: "section 21 eviction notice from my landlord",
};

assert.equal(parkedOffMatchingHelp("Asylum Support Appeals Project (ASAP)", "Home Office housing"), true);
assert.equal(parkedOffMatchingHelp("Housing Loss Prevention Advice Service", ""), true);
assert.equal(
  matchesDispute({ title: "Asylum Support Appeals Project (ASAP)", blurb: "Home Office housing" }, neighbour),
  false,
);
assert.equal(
  matchesDispute({ title: "Housing Loss Prevention Advice Service", blurb: "possession" }, tenancy),
  false,
);
assert.equal(matchesDispute({ title: "Shelter Housing Advice", blurb: "eviction and homelessness" }, neighbour), false);
assert.equal(matchesDispute({ title: "LEASE (leasehold advice)", blurb: "service charges" }, neighbour), false);
assert.equal(matchesDispute({ title: "Justice for Tenants", blurb: "tenants" }, neighbour), false);
assert.equal(matchesDispute({ title: "Shelter Housing Advice", blurb: "eviction and homelessness" }, tenancy), true);
assert.equal(matchesDispute({ title: "Justice for Tenants", blurb: "representation for tenants" }, tenancy), true);
assert.equal(
  matchesDispute({ title: "LEASE (leasehold advice)", blurb: "service charges" }, tenancy),
  false,
);

const curated = curateMatchingProviders(
  [
    { name: "Citizens Advice housing page", blurb: "housing", url: "https://www.citizensadvice.org.uk/housing", positioning: "charity", sraId: undefined },
    { name: "Shelter Housing Advice", blurb: "eviction", url: "https://england.shelter.org.uk/", positioning: "charity", sraId: undefined },
    { name: "Citizens Advice Adviceline (England)", blurb: "phone advice", url: "https://www.citizensadvice.org.uk/", positioning: "helpline", sraId: undefined },
    { name: "Asylum Support Appeals Project (ASAP)", blurb: "Home Office housing", url: "https://www.asaproject.org/", positioning: "charity", sraId: undefined },
  ],
  tenancy,
);

assert.deepEqual(
  curated.map((row) => row.name),
  ["Shelter Housing Advice", "Citizens Advice Adviceline (England)"],
);

console.log("matching-relevance-check ok");
