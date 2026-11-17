import type { DisputeKind } from "@/lib/cases/dispute-context";

export type FundingKnowledge = "never_heard" | "heard" | "used_before";

export type FundingPreference =
  | "legal_aid"
  | "pro_bono"
  | "fixed_fee"
  | "private"
  | "unsure"
  | "insurance";

export type CaseStatus = "open" | "exploring" | "contacted" | "handed_off";

export type ActionPlanDoorType =
  | "free_advice"
  | "legal_aid"
  | "directory"
  | "self_help"
  | "paid";

export type ActionPlanStep = {
  id: string;
  label: string;
  detail: string;
  doorType?: ActionPlanDoorType;
  url?: string;
  spendAdvice?: string;
};

export type ActionPlanFreeService = {
  id: string;
  name: string;
  blurb: string;
  url?: string;
  phone?: string;
};

/** SRA-register firm suggested after the client opts to speak to a solicitor. */
export type ActionPlanSolicitor = {
  id: string;
  name: string;
  blurb: string;
  url?: string;
  phone?: string;
  city?: string;
  postcode?: string;
  sraId?: string;
  matchReason?: string;
};

/** One door on the claim-financing map (free → insurance → CFA/ATE → funders). */
export type ActionPlanFinancingOption = {
  id: string;
  title: string;
  blurb: string;
  likelihood?: "often" | "sometimes" | "rare" | "unlikely";
  url?: string;
  sourceLabel?: string;
};

export type ActionPlanFinancingContact = {
  id: string;
  name: string;
  role: "funder" | "broker" | "marketplace" | "guidance";
  blurb: string;
  url?: string;
};

export type ActionPlanFinancingMap = {
  complexity: "standard" | "complex";
  complexityReason: string;
  honestNote: string;
  options: ActionPlanFinancingOption[];
  contacts: ActionPlanFinancingContact[];
};

export type ActionPlanLegalAidDoor = {
  id: string;
  title: string;
  band: "often" | "sometimes" | "rare" | "rarely_or_never";
  summary: string;
  examples?: string[];
  url?: string;
};

export type ActionPlanLegalAidMap = {
  scopeBand: "often" | "sometimes" | "rare" | "rarely_or_never";
  headline: string;
  outOfScopeNote: string;
  meritsNote: string;
  honestNote: string;
  likelihood?: "likely" | "possible" | "unlikely" | "unsure" | null;
  doors: ActionPlanLegalAidDoor[];
  meansRules: Array<{ id: string; title: string; summary: string; url?: string }>;
  nextSteps: string[];
  checkUrl: string;
  findProviderUrl: string;
};

export type ActionPlanUcDoor = {
  id: string;
  title: string;
  band: "do_now" | "usual_next" | "if_needed" | "rare";
  summary: string;
  deadlineHint?: string;
  url?: string;
};

export type ActionPlanUcLawTopic = {
  id: string;
  title: string;
  rightInPlainEnglish: string;
  whatItMeansForYou: string;
  sourceUrl?: string;
  sourceLabel?: string;
};

export type ActionPlanUcMap = {
  stage: string;
  headline: string;
  lawTopics: ActionPlanUcLawTopic[];
  entitlementLikelihood: "likely" | "possible" | "unlikely" | "unsure";
  entitlementSummary: string;
  appealLikelihood: "likely" | "possible" | "unlikely" | "unsure";
  appealSummary: string;
  processDoors: ActionPlanUcDoor[];
  helpDoors: ActionPlanFreeService[];
  evidenceTips: string[];
  financingNote: string;
  legalAidNote: string;
  nextSteps: string[];
  honestNote: string;
  checkUrl: string;
  appealUrl: string;
  eligibilityUrl: string;
};

export type ActionPlan = {
  steps: ActionPlanStep[];
  /** Relevant free doors for this dispute type */
  freeServices?: ActionPlanFreeService[];
  /** Matched SRA firms when the client asked for a solicitor */
  matchedSolicitors?: ActionPlanSolicitor[];
  solicitorMatchMode?: "local" | "online" | "reviews" | "unsure";
  solicitorLocation?: string | null;
  /** Full financing menu + selective funders/brokers */
  financingMap?: ActionPlanFinancingMap | null;
  /** Civil legal aid scope + means knowledge for this claim type */
  legalAidMap?: ActionPlanLegalAidMap | null;
  /** Universal Credit / benefits claim path map */
  universalCreditMap?: ActionPlanUcMap | null;
  /** Pro Bono Week guide attribution for free-advice doors */
  freeAdviceGuide?: {
    nation: "england" | "wales" | "scotland" | "unknown";
    nationLabel: string;
    hubUrl: string;
    pdfUrl: string;
    pdfLabel: string;
    notes: string[];
  } | null;
  updatedAt: string;
};

export type CaseAttachment = {
  id: string;
  name: string;
  mime: string;
  size: number;
  /** Local data URL for small uploads in v1 */
  dataUrl?: string;
  uploadedAt: string;
};

export type CaseProfileAnswers = {
  disputeStory?: string;
  disputeKind?: DisputeKind;
  /** How many times we asked the client to flesh out a thin story */
  storyDeepenCount?: number;
  /** Answers keyed by dispute question id */
  disputeAnswers?: Record<string, string>;
  processAwareness?: string;
  /** Early interest in speaking to a human (e.g. about divorce). */
  wantSpeakToSomeone?: string;
  /** How to match an SRA solicitor: local, online, or by reviews. */
  solicitorMatchMode?: "local" | "online" | "reviews" | "unsure";
  /** Town / postcode when they want someone local. */
  solicitorLocation?: string;
  optionsExplanation?: string;
  optionsClarify?: string;
  /** Whether they’ve already used free services that may apply. */
  freeServicesTried?: string;
  /** Universal Credit rights / entitlement screen answers */
  ucAnswers?: Record<string, string>;
  ucEntitlementLikelihood?: "likely" | "possible" | "unlikely" | "unsure";
  ucAppealLikelihood?: "likely" | "possible" | "unlikely" | "unsure";
  ucRightsSummary?: string;
  legalAidHeard?: string;
  /** Legacy single answer — prefer legalAidAnswers */
  legalAidQualify?: string;
  /** Screening answers keyed by LegalAidScreenId */
  legalAidAnswers?: Record<string, string>;
  legalAidLikelihood?: "likely" | "possible" | "unlikely" | "unsure";
  legalAidSummary?: string;
  freeAdviceFirst?: string;
  openToPaying?: string;
  insuranceCover?: string;
  /** England / Wales / Scotland for free-advice guide selection */
  ukNation?: "england" | "wales" | "scotland" | "unknown";
};

export type CaseRecord = {
  id: string;
  userId: string;
  title: string;
  summary: string | null;
  matterType: string | null;
  jurisdiction: string | null;
  locationHint: string | null;
  status: CaseStatus;
  fundingKnowledge: FundingKnowledge | null;
  fundingPreference: FundingPreference | null;
  fundingNotes: string | null;
  profileAnswers: CaseProfileAnswers | null;
  actionPlan: ActionPlan | null;
  attachments: CaseAttachment[] | null;
  sessionSnapshot: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

export type CaseUpsertInput = {
  title?: string;
  summary?: string | null;
  matterType?: string | null;
  jurisdiction?: string | null;
  locationHint?: string | null;
  status?: CaseStatus;
  fundingKnowledge?: FundingKnowledge | null;
  fundingPreference?: FundingPreference | null;
  fundingNotes?: string | null;
  profileAnswers?: CaseProfileAnswers | null;
  actionPlan?: ActionPlan | null;
  attachments?: CaseAttachment[] | null;
  sessionSnapshot?: Record<string, unknown> | null;
};
