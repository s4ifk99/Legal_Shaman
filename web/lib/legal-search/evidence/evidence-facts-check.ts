/**
 * Review, cost, and timescale facts stay low confidence unless a source supports them.
 * Run: npm run test:evidence-facts
 */
import assert from "node:assert/strict";
import { disputeTimescaleForSlug } from "./dispute-timescales";
import { extractPublishedFeeFromText } from "./fee-page-extract";
import { countHiddenUnknown, evidenceMatchesFilters } from "./filters";
import { matchFirmIdentity } from "./identity-match";
import { extractSiteAggregateRating } from "@/lib/provider-crawler/extract-site-aggregate-rating";
import { buildProviderEvidence } from "./provider-facts";
import { isAcceptablePublishedPrice, lookupPublishedPrice } from "./published-prices";
import type { ProviderEvidence, PublishedPriceRecord } from "./types";

const published: PublishedPriceRecord = {
  resultId: "sra:example",
  providerName: "Example LLP",
  service: "unfair dismissal advice",
  minPence: 150000,
  maxPence: 300000,
  currency: "GBP",
  sourceUrl: "https://example.test/pricing",
  checkedOn: "2026-10-01",
};

function assertLowReview(evidence: ProviderEvidence) {
  assert.equal(evidence.review.confidence, "low");
  assert.equal(evidence.review.reviewStars, null);
  assert.equal(evidence.review.reviewCount, null);
  assert.match(evidence.review.label, /No verified reviews/);
}

const proBono = buildProviderEvidence({ resultId: "probono:1", sectionKind: "pro_bono" });
assert.equal(proBono.cost.confidence, "high");
assert.equal(proBono.cost.costBand, "free");
assert.doesNotMatch(proBono.cost.label, /£\d/);
assertLowReview(proBono);

const legalAid = buildProviderEvidence({ resultId: "legal_aid:1", sectionKind: "legal_aid" });
assert.equal(legalAid.cost.confidence, "high");
assert.equal(legalAid.cost.costBand, "legal_aid");
assert.equal(legalAid.cost.costMinPence, null);
assert.equal(legalAid.cost.costMaxPence, null);
assert.doesNotMatch(legalAid.cost.label, /£/);

const seeded = buildProviderEvidence({
  resultId: "lawyer:seed",
  sectionKind: "private",
  seedRating: 4.9,
});
assertLowReview(seeded);
assert.equal(seeded.cost.confidence, "low");
assert.equal(seeded.cost.costBand, "unpublished");
assert.match(seeded.cost.label, /Price not published/);

const pending = buildProviderEvidence({
  resultId: "sra:1",
  sectionKind: "private",
  reviewSignals: [
    {
      entityId: "sra:1",
      signalType: "review_aggregate_rating",
      value: "4.6",
      sourceUrl: "https://www.trustpilot.com/review/example",
      status: "pending_review",
    },
    {
      entityId: "sra:1",
      signalType: "review_count",
      value: "80",
      sourceUrl: "https://www.trustpilot.com/review/example",
      status: "pending_review",
    },
  ],
});
assertLowReview(pending);

const zeroStars = buildProviderEvidence({
  resultId: "sra:1",
  sectionKind: "private",
  reviewSignals: [
    {
      entityId: "sra:1",
      signalType: "review_aggregate_rating",
      value: "0",
      sourceUrl: "https://www.trustpilot.com/review/example",
      status: "approved",
    },
    {
      entityId: "sra:1",
      signalType: "review_count",
      value: "12",
      sourceUrl: "https://www.trustpilot.com/review/example",
      status: "approved",
    },
  ],
});
assertLowReview(zeroStars);

const verified = buildProviderEvidence({
  resultId: "sra:1",
  sectionKind: "private",
  reviewSignals: [
    {
      entityId: "sra:1",
      signalType: "review_aggregate_rating",
      value: "4.6",
      sourceUrl: "https://www.trustpilot.com/review/example",
      sourceType: "trustpilot_api",
      status: "approved",
    },
    {
      entityId: "sra:1",
      signalType: "review_count",
      value: "80",
      sourceUrl: "https://www.trustpilot.com/review/example",
      sourceType: "trustpilot_api",
      status: "approved",
    },
  ],
});
assert.equal(verified.review.confidence, "high");
assert.equal(verified.review.reviewStars, 4.6);
assert.equal(verified.review.reviewCount, 80);
assert.equal(verified.review.sourceUrl, "https://www.trustpilot.com/review/example");
assert.match(verified.review.label, /Trustpilot: 4\.6 from 80 reviews/);
assert.equal(verified.review.sources?.[0]?.name, "Trustpilot");

const googleOnly = buildProviderEvidence({
  resultId: "sra:google",
  sectionKind: "private",
  reviewSignals: [
    {
      entityId: "sra:google",
      signalType: "google_places:review_aggregate_rating",
      value: "4.5",
      sourceUrl: "https://maps.google.com/?cid=1",
      sourceType: "google_places",
      status: "auto_approved",
    },
    {
      entityId: "sra:google",
      signalType: "google_places:review_count",
      value: "100",
      sourceUrl: "https://maps.google.com/?cid=1",
      sourceType: "google_places",
      status: "auto_approved",
    },
  ],
});
assert.equal(googleOnly.review.confidence, "high");
assert.equal(googleOnly.review.reviewStars, 4.5);
assert.equal(googleOnly.review.reviewCount, 100);
assert.match(googleOnly.review.label, /Google Maps: 4\.5 from 100 reviews/);
assert.equal(googleOnly.review.sources?.[0]?.name, "Google Maps");
assert.equal(
  evidenceMatchesFilters(googleOnly, { reviews: "four_plus", cost: "all" }),
  true,
);

const bothSources = buildProviderEvidence({
  resultId: "sra:both",
  sectionKind: "private",
  reviewSignals: [
    {
      entityId: "sra:both",
      signalType: "google_places:review_aggregate_rating",
      value: "4.2",
      sourceUrl: "https://maps.google.com/?cid=2",
      sourceType: "google_places",
      status: "auto_approved",
    },
    {
      entityId: "sra:both",
      signalType: "google_places:review_count",
      value: "40",
      sourceUrl: "https://maps.google.com/?cid=2",
      sourceType: "google_places",
      status: "auto_approved",
    },
    {
      entityId: "sra:both",
      signalType: "trustpilot:review_aggregate_rating",
      value: "4.8",
      sourceUrl: "https://www.trustpilot.com/review/both",
      sourceType: "trustpilot_api",
      status: "auto_approved",
    },
    {
      entityId: "sra:both",
      signalType: "trustpilot:review_count",
      value: "20",
      sourceUrl: "https://www.trustpilot.com/review/both",
      sourceType: "trustpilot_api",
      status: "auto_approved",
    },
  ],
});
assert.equal(bothSources.review.confidence, "high");
assert.match(bothSources.review.label, /Google Maps: 4\.2 from 40 reviews/);
assert.match(bothSources.review.label, /Trustpilot: 4\.8 from 20 reviews/);
assert.doesNotMatch(bothSources.review.label, /4\.5/); // no blended average
assert.equal(bothSources.review.reviewStars, 4.8); // best source for filters
assert.equal(bothSources.review.sources?.length, 2);

const siteHarvest = buildProviderEvidence({
  resultId: "sra:site",
  sectionKind: "private",
  reviewSignals: [
    {
      entityId: "sra:site",
      signalType: "site:review_aggregate_rating",
      value: "4.9",
      sourceUrl: "https://alpha-law.test/about",
      sourceType: "provider_website",
      status: "auto_approved",
    },
    {
      entityId: "sra:site",
      signalType: "site:review_count",
      value: "55",
      sourceUrl: "https://alpha-law.test/about",
      sourceType: "provider_website",
      status: "auto_approved",
    },
    {
      entityId: "sra:site",
      signalType: "site:review_publisher",
      value: "Google Maps",
      sourceUrl: "https://alpha-law.test/about",
      sourceType: "provider_website",
      status: "auto_approved",
    },
  ],
});
assert.equal(siteHarvest.review.confidence, "high");
assert.equal(siteHarvest.review.reviewStars, 4.9);
assert.equal(siteHarvest.review.reviewCount, 55);
assert.match(siteHarvest.review.label, /Google Maps: 4\.9 from 55 reviews/);
assert.equal(siteHarvest.review.sources?.[0]?.name, "Google Maps");
assert.equal(siteHarvest.review.sourceUrl, "https://alpha-law.test/about");
assert.equal(
  evidenceMatchesFilters(bothSources, { reviews: "four_plus", cost: "all" }),
  true,
);

const weakMatch = matchFirmIdentity({
  firmName: "Alpha Solicitors",
  firmPostcode: "SW1A 1AA",
  firmWebsite: "https://alpha-law.test",
  candidateName: "Beta Legal",
  candidatePostcode: "E1 6AN",
  candidateWebsite: "https://other.test",
});
assert.equal(weakMatch.strong, false);
assert.ok(weakMatch.score < 0.9);

const strongHost = matchFirmIdentity({
  firmName: "Alpha Solicitors",
  firmWebsite: "https://www.alpha-law.test/contact",
  candidateName: "Something Else",
  candidateWebsite: "https://alpha-law.test",
});
assert.equal(strongHost.strong, true);
assert.equal(strongHost.reason, "website_host");

const priced = buildProviderEvidence({
  resultId: published.resultId,
  sectionKind: "private",
  publishedPrice: published,
});
assert.equal(priced.cost.confidence, "high");
assert.equal(priced.cost.costBand, "published_fee");
assert.match(priced.cost.label, /£1,500–£3,000/);
assert.equal(priced.cost.sourceUrl, published.sourceUrl);

assert.equal(
  isAcceptablePublishedPrice({ ...published, sourceUrl: "" }),
  false,
);
assert.equal(
  isAcceptablePublishedPrice({ ...published, providerName: "  " }),
  false,
);
const missingUrl = buildProviderEvidence({
  resultId: "sra:2",
  sectionKind: "private",
  publishedPrice: { ...published, resultId: "sra:2", sourceUrl: "" },
});
assert.equal(missingUrl.cost.confidence, "low");
assert.equal(lookupPublishedPrice("sra:example"), null);

const feePage = extractPublishedFeeFromText(
  "Price transparency. Unfair dismissal claims typically cost £1,500 to £3,000 plus VAT.",
);
assert.ok(feePage);
assert.equal(feePage!.minPence, 150000);
assert.equal(feePage!.maxPence, 300000);
assert.match(feePage!.service, /employment tribunal/i);
assert.equal(feePage!.vatNote, "exclusive of VAT");

const incompleteFee = extractPublishedFeeFromText("We offer competitive rates. Contact us.");
assert.equal(incompleteFee, null);

const unknownTimescale = disputeTimescaleForSlug("not-a-real-area");
assert.equal(unknownTimescale.confidence, "low");
assert.match(unknownTimescale.rangeText, /No official timescale/);
assert.doesNotMatch(unknownTimescale.rangeText, /\d+\s*weeks/);

const unclearTimescale = disputeTimescaleForSlug(null);
assert.equal(unclearTimescale.confidence, "low");
assert.equal(unclearTimescale.matterLabel, "This dispute");

const employment = disputeTimescaleForSlug("employment");
assert.equal(employment.confidence, "high");
assert.match(employment.rangeText, /26 weeks/);
assert.equal(
  employment.sourceUrl,
  "https://www.gov.uk/government/publications/employment-tribunals-after-your-claim-is-accepted-t421/employment-tribunal-what-happens-after-you-submit-a-claim-t421",
);
assert.equal(employment.matterLabel, "Employment Law");

const family = disputeTimescaleForSlug("family");
assert.equal(family.confidence, "low");
assert.doesNotMatch(family.rangeText, /\d/);

const cards: ProviderEvidence[] = [seeded, verified, priced, legalAid, proBono, googleOnly];

const fourPlus = { reviews: "four_plus" as const, cost: "all" as const };
assert.deepEqual(
  cards.filter((card) => evidenceMatchesFilters(card, fourPlus)),
  [verified, googleOnly],
);
assert.equal(
  countHiddenUnknown(cards, (card) => card, fourPlus),
  4,
);

const publishedOnly = { reviews: "all" as const, cost: "published_fee" as const };
assert.deepEqual(
  cards.filter((card) => evidenceMatchesFilters(card, publishedOnly)),
  [priced],
);
assert.equal(
  countHiddenUnknown(cards, (card) => card, publishedOnly),
  3,
);

const threeStar: ProviderEvidence = {
  review: {
    label: "3 out of 5 from 10 reviews.",
    confidence: "high",
    reviewStars: 3,
    reviewCount: 10,
    sourceUrl: "https://www.trustpilot.com/review/example",
  },
  cost: priced.cost,
};
assert.equal(
  evidenceMatchesFilters(threeStar, { reviews: "four_plus", cost: "all" }),
  false,
);
assert.equal(
  countHiddenUnknown([threeStar], (card) => card, { reviews: "four_plus", cost: "all" }),
  0,
);

const siteLd = extractSiteAggregateRating(`
  <html><head>
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"LegalService","name":"Alpha Solicitors",
   "aggregateRating":{"@type":"AggregateRating","ratingValue":"4.7","reviewCount":"120"}}
  </script>
  </head></html>
`);
assert.ok(siteLd);
assert.equal(siteLd!.rating, 4.7);
assert.equal(siteLd!.reviewCount, 120);
assert.equal(siteLd!.publisherLabel, "Firm website");

const siteGoogleLd = extractSiteAggregateRating(`
  <script type="application/ld+json">
  {"@type":"LocalBusiness","name":"Alpha","aggregateRating":
    {"@type":"AggregateRating","ratingValue":5,"ratingCount":10,"name":"Google reviews"}}
  </script>
`);
assert.ok(siteGoogleLd);
assert.equal(siteGoogleLd!.publisher, "google");

console.log("evidence facts checks passed");
