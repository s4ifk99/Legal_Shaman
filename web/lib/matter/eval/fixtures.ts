import type { MatterEvalCase } from "./types";
import { MATTER_EVAL_ADVERSARIAL } from "./fixtures-adversarial";
import { MATTER_EVAL_COVERAGE } from "./fixtures-coverage";

/** Original known-failure set — architecture must not regress these. */
export const MATTER_EVAL_REGRESSION: MatterEvalCase[] = [
  {
    id: "pcn-workplace-001",
    suite: "regression",
    label: "Hounslow PCN + at work backdrop",
    submission: `This happened to someone at my work. He used a road that doesn't allow cars without a permit during 9am to 7pm in west London. He received 4 PCNs from Hounslow council across 9 days. Are there any grounds to appeal the other 3? I was reading that London Tribunals usually waives circumstances like this.`,
    expected: {
      primaryIssuesAny: ["parking_pcn"],
      secondaryIssuesAny: [],
      mustExclude: ["employment"],
      mustRetrieveConcepts: ["parking", "appeal", "tribunal"],
      mustNotRetrieveDomains: ["employment", "used car", "used_vehicle"],
      helpMatchPracticeAny: ["motoring", "consumer", "parking"],
    },
  },
  {
    id: "garage-work-van-002",
    suite: "regression",
    label: "Works van garage repair",
    submission: `I took my works van to a garage because the expansion tank was leaking. They charged me £800 but the fault came back after two days. My employer says it's nothing to do with them. The garage says it's wear and tear. Do I have any consumer rights?`,
    expected: {
      primaryIssuesAny: ["consumer_vehicle_repair"],
      mustExclude: ["employment", "parking_pcn"],
      mustRetrieveConcepts: ["repair", "garage", "consumer"],
      mustNotRetrieveDomains: ["employment", "parking", "insurance"],
      helpMatchPracticeAny: ["consumer"],
    },
  },
  {
    id: "estate-agent-demolition-003",
    suite: "regression",
    label: "Estate agent flat demolition misrepresentation",
    submission: `Major estate agent has listed a flat for sale. It was cash only. I asked about cladding and management fees — they said no issues. I hired a surveyor and solicitor and am £2400 in. The building is due to be demolished within 2 years and the agent never listed this. Have I got grounds to go after the estate agent for misrepresenting this?`,
    expected: {
      primaryIssuesAny: ["conveyancing"],
      secondaryIssuesAny: ["consumer", "consumer_services"],
      mustExclude: ["used_vehicle", "travel_agent", "distance_contracts"],
      mustRetrieveConcepts: ["misrepresentation", "property", "estate"],
      mustNotRetrieveDomains: ["used car", "travel agent", "consumer contracts", "employment"],
      helpMatchPracticeAny: ["property", "conveyancing", "litigation"],
    },
  },
  {
    id: "shared-housing-disrepair-004",
    suite: "regression",
    label: "Shared housing / disrepair",
    submission: `I share a flat with two flatmates on a joint tenancy. There is severe mould in my bedroom and the landlord has ignored emails for months. One flatmate stopped paying rent and the landlord is blaming all of us. What are my rights?`,
    expected: {
      primaryIssuesAny: ["housing"],
      mustExclude: ["used_vehicle"],
      mustRetrieveConcepts: ["housing", "landlord", "tenant", "mould", "disrepair"],
      mustNotRetrieveDomains: ["used car", "employment", "parking"],
      helpMatchPracticeAny: ["housing", "property"],
    },
  },
  {
    id: "multi-issue-landlord-005",
    suite: "regression",
    label: "Multi-issue landlord matter",
    submission: `My landlord has ignored black mould for 6 months, has now served a section 21 notice, and is refusing to return my £1200 deposit. I am a tenant in England. What can I do about all of this?`,
    expected: {
      primaryIssuesAny: ["housing"],
      mustRetrieveConcepts: ["mould", "disrepair", "section 21", "deposit"],
      mustNotRetrieveDomains: ["used car", "employment", "immigration"],
      helpMatchPracticeAny: ["housing"],
    },
  },
  {
    id: "ambiguous-submission-006",
    suite: "regression",
    label: "Ambiguous legal help request",
    submission: `Something happened at work and now I have a letter about money and a deadline. I'm not sure if it's my boss or something else. I need to know what to do.`,
    expected: {
      primaryIssuesAny: ["employment", "debt", "consumer"],
      expectLowConfidence: true,
      expectAmbiguities: true,
      mustNotRetrieveDomains: ["used car", "travel agent"],
    },
  },
  {
    id: "cov-employer-family-dual-010",
    suite: "coverage",
    label: "Director ending PAYE during family proceedings",
    submission: `I'm going through divorce/family proceedings with my ex-wife, who has been on PAYE through my limited company for over 10 years. She is not carrying out any work or duties for the business but continues to receive pay and has use of a company vehicle. What are my options for lawfully ending her employment? What is the correct way to recover the company vehicle? Should an employment solicitor coordinate with my family solicitor?`,
    expected: {
      primaryIssuesAny: ["employment"],
      secondaryIssuesAny: ["family"],
      mustExclude: ["discrimination_equality"],
      mustRetrieveConcepts: ["employment"],
      mustNotRetrieveDomains: ["used car", "parking", "section 21"],
      helpMatchPracticeAny: ["employment"],
      mustRelationshipTypes: ["employment"],
    },
  },
];

export const MATTER_EVAL_FIXTURES: MatterEvalCase[] = [
  ...MATTER_EVAL_REGRESSION,
  ...MATTER_EVAL_COVERAGE,
  ...MATTER_EVAL_ADVERSARIAL,
];
