import type { MatterEvalCase } from "./types";

/** Cases not derived from prior production failures — tests generalisation. */
export const MATTER_EVAL_COVERAGE: MatterEvalCase[] = [
  {
    id: "cov-employment-obvious-007",
    suite: "coverage",
    label: "Straightforward unfair dismissal",
    submission: `I have worked for the same employer for four years. Last Friday they dismissed me without notice or a meeting. They just emailed to say not to come in. I want to know if this is unfair dismissal.`,
    expected: {
      primaryIssuesAny: ["employment"],
      mustExclude: ["parking_pcn", "used_vehicle"],
      mustRetrieveConcepts: ["dismiss", "employment"],
      mustNotRetrieveDomains: ["parking", "used car", "section 21"],
      helpMatchPracticeAny: ["employment"],
    },
  },
  {
    id: "cov-small-claim-procedural-008",
    suite: "coverage",
    label: "Procedural small claim for faulty toaster",
    submission: `How do I start a small claim in the county court for a faulty toaster the shop will not refund? I already complained in writing.`,
    expected: {
      primaryIssuesAny: ["consumer", "consumer_small_claims", "consumer_services"],
      mustRetrieveConcepts: ["claim", "consumer"],
      mustNotRetrieveDomains: ["employment", "parking", "immigration"],
      helpMatchPracticeAny: ["consumer"],
    },
  },
  {
    id: "cov-deposit-remedy-009",
    suite: "coverage",
    label: "Remedy-only deposit question",
    submission: `Can I get my tenancy deposit back? The landlord is ignoring my emails since I moved out last month.`,
    expected: {
      primaryIssuesAny: ["housing"],
      mustRetrieveConcepts: ["deposit", "tenant"],
      mustNotRetrieveDomains: ["used car", "employment"],
      helpMatchPracticeAny: ["housing", "property"],
    },
  },
  {
    id: "cov-scotland-housing-010",
    suite: "coverage",
    label: "Wrong-jurisdiction risk: Glasgow tenant",
    submission: `I am a tenant in Glasgow. My landlord will not repair the heating and it has been off for three weeks. What are my rights in Scotland?`,
    expected: {
      primaryIssuesAny: ["housing"],
      mustRetrieveConcepts: ["landlord", "repair", "tenant"],
      mustNotRetrieveDomains: ["employment", "used car"],
      helpMatchPracticeAny: ["housing", "property"],
    },
  },
  {
    id: "cov-jargon-conveyancing-011",
    suite: "coverage",
    label: "Legal jargon: specific performance of land contract",
    submission: `I seek specific performance of a contract for the sale of land after the vendor purported to rescind. Completion was due last Friday. The property is in Manchester.`,
    expected: {
      primaryIssuesAny: ["conveyancing"],
      mustExclude: ["used_vehicle", "travel_agent"],
      mustRetrieveConcepts: ["property", "sale", "completion"],
      mustNotRetrieveDomains: ["used car", "employment", "parking"],
      helpMatchPracticeAny: ["property", "conveyancing", "litigation"],
    },
  },
  {
    id: "cov-nonlegal-noise-012",
    suite: "coverage",
    label: "Non-legal complaint: barking dog",
    submission: `My neighbour's dog barks all night and I cannot sleep. I have asked them politely. I just want it to stop.`,
    expected: {
      primaryIssuesAny: ["neighbour_dispute", "housing"],
      mustRelationshipTypes: ["neighbours"],
      mustNotRetrieveDomains: ["used car", "employment", "parking"],
      helpMatchPracticeAny: ["housing", "property"],
    },
  },
  {
    id: "cov-long-housing-013",
    suite: "coverage",
    label: "Long submission with housing core",
    submission: `This has been going on for a long time and I am exhausted. I moved into the flat in March with my partner. We pay rent on time every month. The boiler broke in May and we mentioned it to the agent. Then in June the ceiling in the bathroom started staining. We sent photos. In July black mould appeared behind the wardrobe. I have asthma. The agent said they would send someone. Nobody came. I called three times. My partner printed the emails. Last week we got a letter about rent. I am not sure what the letter is for but the mould is the main problem and the landlord still has not sent a contractor. I need to know what I can do as a tenant in England.`,
    expected: {
      primaryIssuesAny: ["housing"],
      mustRetrieveConcepts: ["mould", "landlord", "tenant"],
      mustNotRetrieveDomains: ["used car", "parking"],
      helpMatchPracticeAny: ["housing"],
    },
  },
  {
    id: "cov-fact-poor-014",
    suite: "coverage",
    label: "Fact-poor: they took my money",
    submission: `They took my money and now they won't give it back. What can I do?`,
    expected: {
      primaryIssuesAny: ["consumer", "debt", "housing"],
      allowEmptyPrimary: true,
      resolutionStatusAny: ["insufficient_facts", "partially_resolved"],
      expectLowConfidence: true,
      expectAmbiguities: true,
      mustNotRetrieveDomains: ["travel agent"],
    },
  },
];
