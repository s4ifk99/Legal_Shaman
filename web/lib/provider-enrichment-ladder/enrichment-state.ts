import { z } from "zod";

export const EnrichmentLadderStatusSchema = z.enum([
  "not_started",
  "planned",
  "website_discovered",
  "contact_extracted",
  "practice_extracted",
  "pending_review",
  "approved",
  "rejected",
  "failed",
  "retry_later",
]);

export type EnrichmentLadderStatus = z.infer<typeof EnrichmentLadderStatusSchema>;

const TRANSITIONS: Record<EnrichmentLadderStatus, EnrichmentLadderStatus[]> = {
  not_started: ["planned", "failed", "retry_later"],
  planned: ["website_discovered", "contact_extracted", "practice_extracted", "pending_review", "failed", "retry_later"],
  website_discovered: ["contact_extracted", "practice_extracted", "pending_review", "failed", "retry_later"],
  contact_extracted: ["practice_extracted", "pending_review", "approved", "failed", "retry_later"],
  practice_extracted: ["pending_review", "approved", "failed", "retry_later"],
  pending_review: ["approved", "rejected", "retry_later"],
  approved: [],
  rejected: ["retry_later", "planned"],
  failed: ["retry_later", "planned"],
  retry_later: ["planned", "not_started"],
};

export function canTransition(
  from: EnrichmentLadderStatus,
  to: EnrichmentLadderStatus,
): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function nextStatusAfterWebsiteDiscovery(
  current: EnrichmentLadderStatus,
): EnrichmentLadderStatus {
  if (current === "not_started" || current === "planned" || current === "retry_later") {
    return "website_discovered";
  }
  return current;
}

export function nextStatusAfterContactExtraction(
  current: EnrichmentLadderStatus,
): EnrichmentLadderStatus {
  if (
    current === "website_discovered" ||
    current === "planned" ||
    current === "not_started"
  ) {
    return "contact_extracted";
  }
  return current;
}

export function nextStatusAfterPracticeExtraction(
  current: EnrichmentLadderStatus,
): EnrichmentLadderStatus {
  if (
    ["contact_extracted", "website_discovered", "planned", "not_started"].includes(current)
  ) {
    return "practice_extracted";
  }
  return current;
}

export function statusHasPendingWork(status: EnrichmentLadderStatus): boolean {
  return !["approved", "rejected"].includes(status);
}
