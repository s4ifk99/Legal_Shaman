export type IdentitySourceType =
  | "local_sra"
  | "sra_api"
  | "yell"
  | "serper"
  | "google"
  | "law_society";

export type IdentityCandidateStatus =
  | "pending_review"
  | "auto_approved"
  | "rejected"
  | "unresolved";

export type SraIdentityCandidateRecord = {
  sraId: string;
  candidateName: string;
  sourceType: IdentitySourceType;
  sourceUrl: string;
  evidenceText: string;
  candidatePhone?: string;
  candidateAddress?: string;
  candidateWebsite?: string;
  matchedPostcode?: string;
  matchedTown?: string;
  confidence: number;
  status: IdentityCandidateStatus;
  rejectReason?: string;
};

export type RecoveryContext = {
  sraId: string;
  orgId: string;
  displayName: string;
  searchText: string;
  postcode: string;
  city: string;
  county: string;
  country: string;
  phone: string;
  addressLine?: string;
};

export type RecoveryCandidatePreview = {
  name: string;
  source: IdentitySourceType;
  confidence?: number;
  status?: IdentityCandidateStatus;
};

export type RecoveryCandidateRejection = {
  name: string;
  source: IdentitySourceType;
  reason: string;
};

export type RecoveryLadderResult = {
  sraId: string;
  candidates: SraIdentityCandidateRecord[];
  queriesRun: string[];
  localQueries: string[];
  sraApiQueries: string[];
  yellQueries: string[];
  serperQueries: string[];
  localCandidatesFound: number;
  yellCandidatesFound: number;
  serperCandidatesFound: number;
  yellCalled: boolean;
  serperCalled: boolean;
  top3SerperResults: { title: string; url: string }[];
  top3YellResults: { businessName: string; address?: string }[];
  top3Candidates: RecoveryCandidatePreview[];
  candidateRejections: RecoveryCandidateRejection[];
  localRecovered: boolean;
  sraApiRecovered: boolean;
  yellRecovered: boolean;
  serperRecovered: boolean;
  api404: boolean;
  lawSocietyFound: boolean;
  webFound: boolean;
  scalableSourcesAttempted: IdentitySourceType[];
  lawSocietySkipped: boolean;
  lawSocietyBlocked: boolean;
  captchaBlocked: boolean;
  rejectedAddressLike: number;
  rejectedWeakEvidence: number;
  decisionReason: string;
  debugNotes?: string[];
};

export type MissingIdentityQueryTiming = {
  queryStart: string;
  queryCompleted?: string;
  rowsLoaded: number;
  elapsedMs?: number;
  pagesFetched?: number;
};

export type MissingIdentityStartupStageRecord = {
  stage: string;
  at: string;
  elapsedMs: number;
  sincePreviousMs?: number;
};

export type MissingIdentityStartupTiming = {
  stages: MissingIdentityStartupStageRecord[];
  totalElapsedMs?: number;
};

export type MissingIdentityBatchResult = {
  event: "sra_recover_identities";
  scanned: number;
  recovered: number;
  autoApproved: number;
  pendingReview: number;
  unresolved: number;
  api404: number;
  localRecovered: number;
  yellRecovered: number;
  serperRecovered: number;
  lawSocietyFound: number;
  webFound: number;
  lawSocietySkipped: number;
  lawSocietyBlocked: number;
  captchaBlocked: number;
  scalableSourcesAttempted: IdentitySourceType[];
  addressLikeRejected: number;
  rejectedAddressLike: number;
  rejectedWeakEvidence: number;
  failed: number;
  dryRun: boolean;
  degraded?: boolean;
  loadError?: string;
  queryTiming?: MissingIdentityQueryTiming;
  startupTiming?: MissingIdentityStartupTiming;
};
