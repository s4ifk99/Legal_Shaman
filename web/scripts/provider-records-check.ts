import assert from "node:assert/strict";
import { toWorkspaceProviders } from "../lib/coherence/providerRecords";
import { housingDeadlineApplies, parseNecessitySlug, urgencyForNecessity } from "../lib/necessity/categories";

const providers = toWorkspaceProviders([
  {
    id: "paid-1",
    type: "SRA-regulated firm",
    title: "Example Solicitors",
    blurb: "A firm",
    sraId: "123",
    city: "Ilford",
    sourceLabel: "SRA register",
  },
  {
    id: "free-1",
    type: "Free · Home and Housing",
    title: "Shelter",
    blurb: "Housing advice",
    url: "https://www.shelter.org.uk/",
    sourceLabel: "Indexed free help",
  },
  {
    id: "aid-1",
    type: "Legal aid",
    title: "Law centre",
    blurb: "Publicly funded",
    sourceLabel: "Indexed free help",
  },
  {
    id: "mystery",
    type: "Listing",
    title: "Unknown desk",
    blurb: "",
    sourceLabel: "Indexed free help",
  },
]);

assert.deepEqual(
  providers.map((provider) => provider.name),
  ["Law centre", "Shelter", "Unknown desk", "Example Solicitors"],
);
assert.equal(providers[0].costLabel, "Publicly funded");
assert.equal(providers[1].reviewsLabel, "No Google review data");
assert.match(providers[1].feeLabel, /free to contact/i);
assert.match(providers[3].feeLabel, /fixed fee/i);
assert.match(providers[1].googleReviewsUrl, /google\.com\/search/);
assert.equal(providers[1].locationLabel, "Location not stated");
assert.equal(providers[1].locationKnown, false);
assert.equal(providers[3].locationLabel, "Ilford");
assert.equal(providers[3].bookmark?.entityId, "123");
assert.equal(providers[1].key, "https://www.shelter.org.uk");
assert.equal(providers[2].costLabel, "Cost not stated");

assert.equal(parseNecessitySlug("pcn"), "pcn");
assert.equal(parseNecessitySlug("nope"), undefined);
assert.ok(urgencyForNecessity("property-housing")?.links.some((link) => /shelter/i.test(link.href)));
assert.equal(urgencyForNecessity("wills-estates"), null);
assert.equal(
  housingDeadlineApplies({
    necessitySlug: "neighbour-disputes",
    matterType: "housing",
    text: "moved fence into my boundary",
  }),
  false,
);
assert.equal(
  housingDeadlineApplies({
    necessitySlug: "property-housing",
    matterType: "housing",
    text: "section 21 eviction notice",
  }),
  true,
);

console.log("provider-records-check ok");
