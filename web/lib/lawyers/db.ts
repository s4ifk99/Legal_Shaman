import "server-only";

import { prisma } from "@/lib/db/prisma";
import { lawyerInclude, type LawyerWithRelations } from "@/lib/lawyers/lawyer-include";

export { lawyerInclude, type LawyerWithRelations };

export async function getLawyerById(id: string): Promise<LawyerWithRelations | null> {
  return prisma.lawyer.findUnique({
    where: { id },
    include: lawyerInclude,
  });
}

export async function getLawyersByIds(ids: string[]): Promise<LawyerWithRelations[]> {
  if (ids.length === 0) return [];
  return prisma.lawyer.findMany({
    where: { id: { in: ids } },
    include: lawyerInclude,
  });
}
