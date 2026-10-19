import { z } from "zod";
import { PROVIDER_NOTE_STATUSES } from "@/lib/provider-notes/types";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : null));

export const ProviderNoteUpsertSchema = z.object({
  providerKey: z.string().trim().min(1).max(512),
  displayName: z.string().trim().min(1).max(512),
  url: z
    .string()
    .trim()
    .max(1024)
    .optional()
    .transform((value) => (value && /^https:\/\//i.test(value) ? value : null)),
  status: z.enum(PROVIDER_NOTE_STATUSES).default("not_contacted"),
  contactedOn: z
    .string()
    .trim()
    .max(32)
    .optional()
    .transform((value) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null)),
  contactName: optionalText(255),
  whatTheySaid: optionalText(4000),
  feesOrEligibility: optionalText(2000),
  followUp: optionalText(2000),
  impression: optionalText(2000),
  shortlisted: z.boolean().optional().default(false),
});
