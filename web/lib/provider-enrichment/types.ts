import { z } from "zod";

export const EnrichmentStatusSchema = z.enum([
  "pending_review",
  "audit_review",
  "approved",
  "rejected",
  "auto_approved",
]);

export type EnrichmentStatus = z.infer<typeof EnrichmentStatusSchema>;

export const EnrichmentSourceTypeSchema = z.enum([
  "structured_db",
  "govuk_legal_aid",
  "provider_website",
  "law_society",
  "sra_register",
  "curated_source",
  "external_directory",
  "trustpilot_api",
  "manual_approved",
]);

export type EnrichmentSourceType = z.infer<typeof EnrichmentSourceTypeSchema>;

export const ExtractionMethodSchema = z.enum([
  "structured_field",
  "regex",
  "libphonenumber",
  "html_parse",
  "manual",
  "capability_patterns",
  "trustpilot_api",
  "robots_skip",
]);

export type ExtractionMethod = z.infer<typeof ExtractionMethodSchema>;

export const ProviderEnrichmentSchema = z.object({
  id: z.string(),
  entityId: z.string(),
  entityType: z.string(),
  fieldName: z.string(),
  extractedValue: z.string(),
  confidence: z.number().min(0).max(1),
  sourceUrl: z.string().optional(),
  sourceType: EnrichmentSourceTypeSchema,
  extractionMethod: ExtractionMethodSchema,
  status: EnrichmentStatusSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type ProviderEnrichment = z.infer<typeof ProviderEnrichmentSchema>;

export type EnrichmentFieldName =
  | "phone"
  | "email"
  | "website"
  | "contactPageUrl"
  | "practiceAreaSlugs"
  | "openingHours"
  | "address"
  | "capabilities"
  | "fundingCapabilities"
  | "urgencyCapabilities"
  | "accessibilityCapabilities"
  | "languages"
  | "tribunalCapabilities";

export type EnrichmentCandidate = {
  entityId: string;
  entityType: string;
  fieldName: EnrichmentFieldName;
  extractedValue: string;
  confidence: number;
  sourceUrl?: string;
  sourceType: EnrichmentSourceType;
  extractionMethod: ExtractionMethod;
  provenanceNote?: string;
};

export type EnrichmentRunStats = {
  scanned: number;
  candidates: number;
  autoApproved: number;
  pendingReview: number;
  rejected: number;
  skipped: number;
  errors: string[];
};
