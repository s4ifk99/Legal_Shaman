import type { MatterEvalCase } from "./types";

/**
 * Intentionally misleading vocabulary — legal relationship ≠ surface nouns.
 * These should fail if the engine only maps known lexical patterns.
 */
export const MATTER_EVAL_ADVERSARIAL: MatterEvalCase[] = [
  {
    id: "adv-tesco-staff-parking-015",
    suite: "adversarial",
    label: "Work + parking ticket in staff car park",
    submission: `I work at Tesco and received a parking ticket in the staff car park.`,
    expected: {
      primaryIssuesAny: ["parking_pcn", "consumer"],
      mustExclude: ["employment"],
      expectAmbiguities: true,
      mustNotRetrieveDomains: ["unfair dismiss", "redundancy"],
      helpMatchPracticeAny: ["motoring", "consumer", "parking"],
    },
  },
  {
    id: "adv-builder-three-weeks-016",
    suite: "adversarial",
    label: "Hired builder — consumer services not employment",
    submission: `I hired a builder who said the works would take three weeks. It has been two months and the extension is unfinished. He still has the rest of the money.`,
    expected: {
      primaryIssuesAny: ["consumer_services", "consumer"],
      mustExclude: ["employment"],
      mustRelationshipTypes: ["consumer_trader_services"],
      mustRetrieveConcepts: ["builder", "workmanship", "consumer", "trader", "service"],
      mustNotRetrieveDomains: ["unfair dismiss", "parking"],
      helpMatchPracticeAny: ["consumer"],
    },
  },
  {
    id: "adv-agent-at-work-solicitor-017",
    suite: "adversarial",
    label: "Agent at work introduced a solicitor",
    submission: `My agent at work introduced me to a solicitor. I am not sure I need one. I just wanted to understand my options.`,
    expected: {
      primaryIssuesAny: ["employment", "consumer", "debt"],
      expectLowConfidence: true,
      expectAmbiguities: true,
      mustNotRetrieveDomains: ["used car", "travel agent"],
    },
  },
  {
    id: "adv-employer-sold-car-018",
    suite: "adversarial",
    label: "Employer sold me his used car",
    submission: `My employer sold me his used car. It broke down a week later and he will not give me my money back.`,
    expected: {
      primaryIssuesAny: ["consumer_vehicle_repair", "consumer"],
      mustExclude: ["parking_pcn"],
      mustRelationshipTypes: ["seller_buyer"],
      mustRetrieveConcepts: ["car", "consumer"],
      mustNotRetrieveDomains: ["parking ticket", "section 21"],
      helpMatchPracticeAny: ["consumer"],
    },
  },
  {
    id: "adv-landlord-is-manager-019",
    suite: "adversarial",
    label: "Landlord also happens to be my manager",
    submission: `My landlord also happens to be my manager. He served notice on the flat after I asked for repairs at home. I still work for him.`,
    expected: {
      primaryIssuesAny: ["housing"],
      secondaryIssuesAny: ["employment"],
      expectAmbiguities: true,
      mustRetrieveConcepts: ["notice", "landlord", "tenant"],
      mustNotRetrieveDomains: ["used car", "parking"],
      helpMatchPracticeAny: ["housing", "property", "employment"],
    },
  },
  {
    id: "adv-van-plumbing-business-020",
    suite: "adversarial",
    label: "Van bought for plumbing business",
    submission: `I bought a van for my plumbing business and it broke. The dealer will not repair it. I need it for work every day.`,
    expected: {
      primaryIssuesAny: ["consumer", "consumer_vehicle_repair"],
      expectAmbiguities: true,
      mustNotRetrieveDomains: ["parking ticket", "unfair dismiss"],
      helpMatchPracticeAny: ["consumer"],
    },
  },
  {
    id: "adv-van-personal-work-use-021",
    suite: "adversarial",
    label: "Van bought personally, used for work",
    submission: `I bought a van personally but I use it for work. It failed its MOT two weeks after purchase and the dealer is refusing a refund.`,
    expected: {
      primaryIssuesAny: ["consumer_vehicle_repair", "consumer"],
      mustExclude: ["employment", "parking_pcn"],
      mustRetrieveConcepts: ["car", "dealer", "consumer", "refund"],
      mustNotRetrieveDomains: ["parking ticket", "section 21"],
      helpMatchPracticeAny: ["consumer"],
    },
  },
  {
    id: "adv-van-limited-company-022",
    suite: "adversarial",
    label: "Van bought through limited company",
    submission: `I bought a van through my limited company. It broke down and the dealer says we have no consumer rights because it was a company purchase.`,
    expected: {
      primaryIssuesAny: ["consumer", "consumer_vehicle_repair"],
      expectAmbiguities: true,
      mustExclude: ["employment", "parking_pcn"],
      mustNotRetrieveDomains: ["unfair dismiss", "parking ticket"],
      helpMatchPracticeAny: ["consumer"],
    },
  },
  {
    id: "adv-manager-crashed-personal-car-023",
    suite: "adversarial",
    label: "Negative control: manager crashed personal car",
    submission: `My manager crashed my personal car. He was giving me a lift home after a shift. The insurer is arguing about whose policy applies.`,
    expected: {
      primaryIssuesAny: ["consumer", "employment", "criminal_defence"],
      allowEmptyPrimary: false,
      resolutionStatusAny: ["relationship_uncertain", "partially_resolved"],
      expectAmbiguities: true,
      expectLowConfidence: true,
      expectLowConfidence: true,
      mustExclude: ["parking_pcn"],
      mustNotRetrieveDomains: ["section 21", "travel agent"],
    },
  },
];
