import type { Prisma } from "@prisma/client";

/** Shared Prisma include — safe for CLI indexing scripts (no server-only). */
export const lawyerInclude = {
  firm: true,
  practiceAreas: { include: { practiceArea: true } },
  locations: true,
  languages: { include: { language: true } },
  credentials: true,
  reviews: { take: 5, orderBy: { createdAt: "desc" } },
  availability: true,
} satisfies Prisma.LawyerInclude;

export type LawyerWithRelations = Prisma.LawyerGetPayload<{
  include: typeof lawyerInclude;
}>;
