import type { FundingRoute } from "@/lib/legal-search/triage/types";
import type { TriageQuestion } from "@/lib/legal-search/triage/types";

export type TriageJourneyTurn = {
  userInput: string;
  /** Pending question field when this turn is submitted (turn 2+). */
  expectedAnswerField?: TriageQuestion["field"];
  /** After this turn completes, next question field (if any). */
  expectedNextQuestionField?: TriageQuestion["field"];
  expectedTaxonomySlug?: string;
  expectedFundingRoute?: FundingRoute;
  expectedUrgency?: "normal" | "elevated" | "urgent";
  mustReturnResults?: boolean;
  mustNotReturnResults?: boolean;
};

export type TriageJourneyFinalExpectations = {
  taxonomySlug?: string;
  acceptableTaxonomySlugs?: string[];
  /** Pass taxonomy check when slug is missing but merged query matches issue heuristics. */
  acceptIssueHeuristic?: boolean;
  issueHeuristicTopics?: Array<
    "employment" | "housing" | "prison" | "immigration" | "family"
  >;
  fundingRoute?: FundingRoute;
  location?: string;
  shouldHaveInternalResults?: boolean;
  shouldHaveExternalFallback?: boolean;
  shouldHaveMapMarkers?: boolean;
  shouldShowUrgentSignposting?: boolean;
  explanationSafetyMustPass: boolean;
  mustAskBeforeSearch?: boolean;
};

export type TriageJourneyCase = {
  id: string;
  turns: TriageJourneyTurn[];
  finalExpectations: TriageJourneyFinalExpectations;
};

export const TRIAGE_JOURNEY_CASES: TriageJourneyCase[] = [
  {
    id: "employment-no-money",
    turns: [
      { userInput: "I lost my job", mustReturnResults: true },
      {
        userInput: "No — not an emergency",
        expectedAnswerField: "emergencyDanger",
      },
      {
        userInput: "Unfair dismissal",
        expectedAnswerField: "subIssue",
      },
      {
        userInput: "London",
        expectedAnswerField: "location",
      },
      {
        userInput: "I can't afford a solicitor",
        expectedAnswerField: "fundingPreference",
        expectedFundingRoute: "legal_aid",
      },
    ],
    finalExpectations: {
      acceptableTaxonomySlugs: ["employment"],
      acceptIssueHeuristic: true,
      issueHeuristicTopics: ["employment"],
      fundingRoute: "legal_aid",
      location: "London",
      shouldHaveInternalResults: true,
      explanationSafetyMustPass: true,
    },
  },
  {
    id: "prison-legal-aid",
    turns: [
      { userInput: "My brother is in prison and it is about parole" },
      {
        userInput: "Birmingham",
        expectedAnswerField: "location",
      },
      {
        userInput: "Legal aid",
        expectedAnswerField: "fundingPreference",
        expectedFundingRoute: "legal_aid",
      },
    ],
    finalExpectations: {
      acceptableTaxonomySlugs: ["prison_law", "criminal_defence", "welfare_benefits"],
      acceptIssueHeuristic: true,
      issueHeuristicTopics: ["prison"],
      fundingRoute: "legal_aid",
      location: "Birmingham",
      shouldHaveInternalResults: true,
      explanationSafetyMustPass: true,
    },
  },
  {
    id: "housing-emergency",
    turns: [
      {
        userInput: "My landlord is kicking me out tonight",
        expectedUrgency: "urgent",
      },
      {
        userInput: "Manchester",
        expectedAnswerField: "location",
      },
      {
        userInput: "Free help",
        expectedAnswerField: "fundingPreference",
        expectedFundingRoute: "pro_bono",
      },
    ],
    finalExpectations: {
      acceptableTaxonomySlugs: ["housing", "criminal_defence"],
      acceptIssueHeuristic: true,
      issueHeuristicTopics: ["housing"],
      fundingRoute: "pro_bono",
      location: "Manchester",
      shouldHaveInternalResults: true,
      shouldShowUrgentSignposting: true,
      explanationSafetyMustPass: true,
    },
  },
  {
    id: "private-divorce",
    turns: [
      { userInput: "I need a divorce solicitor" },
      {
        userInput: "Manchester",
        expectedAnswerField: "location",
      },
      {
        userInput: "Private solicitor",
        expectedAnswerField: "fundingPreference",
        expectedFundingRoute: "private",
      },
    ],
    finalExpectations: {
      acceptableTaxonomySlugs: ["family"],
      fundingRoute: "private",
      location: "Manchester",
      shouldHaveInternalResults: true,
      explanationSafetyMustPass: true,
    },
  },
  {
    id: "immigration-legal-aid",
    turns: [
      { userInput: "My visa was refused" },
      {
        userInput: "Leeds",
        expectedAnswerField: "location",
      },
      {
        userInput: "Legal aid",
        expectedAnswerField: "fundingPreference",
        expectedFundingRoute: "legal_aid",
      },
    ],
    finalExpectations: {
      acceptableTaxonomySlugs: ["immigration", "welfare_benefits"],
      fundingRoute: "legal_aid",
      location: "Leeds",
      shouldHaveInternalResults: true,
      explanationSafetyMustPass: true,
    },
  },
  {
    id: "vague-need-help",
    turns: [
      {
        userInput: "I need help",
        mustReturnResults: true,
        expectedNextQuestionField: "emergencyDanger",
      },
      {
        userInput: "No — not an emergency",
        expectedAnswerField: "emergencyDanger",
        expectedNextQuestionField: "subIssue",
      },
    ],
    finalExpectations: {
      shouldHaveInternalResults: true,
      explanationSafetyMustPass: true,
    },
  },
];
