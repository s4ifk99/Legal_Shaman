import { z } from "zod";

export const SignpostFacetSchema = z.object({
  id: z.string().min(1).max(64),
  need: z.string().min(1).max(500),
  query: z.string().min(1).max(400),
  scope: z
    .string()
    .transform((s) => (s === "open" ? "open" : "allowlist"))
    .pipe(z.enum(["allowlist", "open"])),
  volatile: z.union([z.boolean(), z.string()]).transform((v) => {
    if (typeof v === "boolean") return v;
    return ["1", "true", "yes"].includes(String(v).trim().toLowerCase());
  }),
});

export const SignpostClassificationSchema = z.object({
  jurisdiction: z.string().min(1).max(120),
  localBody: z
    .union([z.string().max(200), z.null()])
    .optional()
    .transform((v) => v ?? null),
  askType: z.string().min(1).max(120),
  boundary: z
    .union([z.string().max(500), z.null()])
    .optional()
    .transform((v) => v ?? null),
  facets: z.array(SignpostFacetSchema).min(2).max(4),
});

export type SignpostFacet = z.infer<typeof SignpostFacetSchema>;
export type SignpostClassification = z.infer<typeof SignpostClassificationSchema>;

export const AdmitJudgmentSchema = z.object({
  facetId: z.string(),
  urlOrId: z.string(),
  relevant: z.boolean(),
  because: z.string().max(400).optional().default(""),
});

export const AdmitJudgmentBatchSchema = z.object({
  judgments: z.array(AdmitJudgmentSchema),
});

export type AdmitJudgment = z.infer<typeof AdmitJudgmentSchema>;

export type AdmitCandidate = {
  facetId: string;
  urlOrId: string;
  title: string;
  excerpt: string;
  date?: string;
  kind: "wiki" | "exa";
  url: string;
};

export type AdmittedEvidence = {
  facetId: string;
  title: string;
  url: string;
  date?: string;
  excerpt: string;
  kind: "wiki" | "exa";
  wikiId?: string;
};

export type SignpostLoopResult = {
  classification: SignpostClassification;
  admitted: AdmittedEvidence[];
  answer: string | null;
  mode: "synthesis" | "insufficient";
  message?: string;
};
