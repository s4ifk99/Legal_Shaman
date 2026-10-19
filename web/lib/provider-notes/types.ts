export const PROVIDER_NOTE_STATUSES = [
  "not_contacted",
  "contacted",
  "awaiting_response",
  "follow_up",
  "not_suitable",
  "engaged",
] as const;

export type ProviderNoteStatus = (typeof PROVIDER_NOTE_STATUSES)[number];

export const PROVIDER_NOTE_STATUS_LABEL: Record<ProviderNoteStatus, string> = {
  not_contacted: "Not contacted",
  contacted: "Contacted",
  awaiting_response: "Awaiting response",
  follow_up: "Follow-up required",
  not_suitable: "Not suitable",
  engaged: "Engaged",
};

export type ProviderNoteRecord = {
  id: string;
  providerKey: string;
  displayName: string;
  url: string | null;
  status: ProviderNoteStatus;
  contactedOn: string | null;
  contactName: string | null;
  whatTheySaid: string | null;
  feesOrEligibility: string | null;
  followUp: string | null;
  impression: string | null;
  shortlisted: boolean;
  updatedAt: string;
};
