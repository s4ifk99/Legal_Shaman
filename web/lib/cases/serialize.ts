import type {
  ActionPlan,
  CaseAttachment,
  CaseProfileAnswers,
  CaseRecord,
  CaseStatus,
  FundingKnowledge,
  FundingPreference,
} from "@/lib/cases/types";

type CaseRow = {
  id: string;
  userId: string;
  title: string;
  summary: string | null;
  matterType: string | null;
  jurisdiction: string | null;
  locationHint: string | null;
  status: string;
  fundingKnowledge: string | null;
  fundingPreference: string | null;
  fundingNotes: string | null;
  profileAnswers: unknown;
  actionPlan: unknown;
  attachments?: unknown;
  sessionSnapshot: unknown;
  createdAt: Date;
  updatedAt: Date;
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

export function toCaseRecord(row: CaseRow): CaseRecord {
  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    summary: row.summary,
    matterType: row.matterType,
    jurisdiction: row.jurisdiction,
    locationHint: row.locationHint,
    status: (row.status || "open") as CaseStatus,
    fundingKnowledge: (row.fundingKnowledge as FundingKnowledge | null) ?? null,
    fundingPreference: (row.fundingPreference as FundingPreference | null) ?? null,
    fundingNotes: row.fundingNotes,
    profileAnswers: (asObject(row.profileAnswers) as CaseProfileAnswers | null) ?? null,
    actionPlan: (asObject(row.actionPlan) as ActionPlan | null) ?? null,
    attachments: Array.isArray(row.attachments)
      ? (row.attachments as CaseAttachment[])
      : null,
    sessionSnapshot: asObject(row.sessionSnapshot),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
