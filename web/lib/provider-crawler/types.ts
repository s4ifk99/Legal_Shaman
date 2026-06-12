import { z } from "zod";

export const CrawlJobStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "skipped",
]);

export type CrawlJobStatus = z.infer<typeof CrawlJobStatusSchema>;

export const CrawlModeSchema = z.enum([
  "contacts",
  "capabilities",
  "trustpilot",
  "testimonials",
  "all",
]);

export type CrawlMode = z.infer<typeof CrawlModeSchema>;

export const CrawlSourceTypeSchema = z.enum([
  "structured_db",
  "govuk_legal_aid",
  "provider_website",
  "law_society",
  "sra_register",
  "curated_source",
  "external_directory",
  "trustpilot_api",
  "manual_approved",
  "yell",
]);

export type CrawlSourceType = z.infer<typeof CrawlSourceTypeSchema>;

export const CrawlExtractionMethodSchema = z.enum([
  "structured_field",
  "regex",
  "libphonenumber",
  "html_parse",
  "capability_patterns",
  "trustpilot_api",
  "robots_skip",
  "manual",
]);

export type CrawlExtractionMethod = z.infer<typeof CrawlExtractionMethodSchema>;

export const ReviewCategorySchema = z.enum(["field", "testimonial", "review_signal"]);

export type ReviewCategory = z.infer<typeof ReviewCategorySchema>;

export const FieldStatusSchema = z.enum([
  "pending_review",
  "audit_review",
  "approved",
  "rejected",
  "auto_approved",
]);

export type FieldStatus = z.infer<typeof FieldStatusSchema>;

export type ExtractedFieldName =
  | "phone"
  | "email"
  | "website"
  | "contact_page"
  | "address"
  | "opening_hours"
  | "practice_areas"
  | "capabilities"
  | "fundingCapabilities"
  | "urgencyCapabilities"
  | "accessibilityCapabilities"
  | "languages"
  | "tribunalCapabilities"
  | "testimonial_snippet"
  | "review_aggregate_rating"
  | "review_count"
  | "trustpilot_profile_url";

export type ExtractedFieldCandidate = {
  entityId: string;
  entityType: string;
  fieldName: ExtractedFieldName;
  extractedValue: string;
  confidence: number;
  sourceUrl?: string;
  sourceType: CrawlSourceType;
  extractionMethod: CrawlExtractionMethod;
  reviewCategory?: ReviewCategory;
  provenanceNote?: string;
  extractedAt?: Date;
};

export type CrawlRunStats = {
  pagesFetched: number;
  pagesSkipped: number;
  fieldsFound: number;
  pendingReview: number;
  autoApproved: number;
  rejected: number;
  errors: string[];
};
