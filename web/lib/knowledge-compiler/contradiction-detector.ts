import { prisma } from "@/lib/db/prisma";

export type ContradictionHit = {
  claimAId: string;
  claimBId: string;
  rationale: string;
};

function claimsConflict(a: string, b: string): boolean {
  const aLow = a.toLowerCase();
  const bLow = b.toLowerCase();
  const negA = /\b(not|never|no |cannot|can't|won't|must not)\b/.test(aLow);
  const negB = /\b(not|never|no |cannot|can't|won't|must not)\b/.test(bLow);
  if (negA !== negB) {
    const tokensA = aLow.split(/\W+/).filter((t) => t.length >= 5);
    const overlap = tokensA.filter((t) => bLow.includes(t)).length;
    if (overlap >= 2) return true;
  }
  return false;
}

export async function detectContradictions(
  conceptId: string,
  newClaimTexts: string[],
): Promise<ContradictionHit[]> {
  const existing = await prisma.knowledgeClaim.findMany({
    where: { conceptId },
    take: 100,
    orderBy: { extractedAt: "desc" },
  });

  const hits: ContradictionHit[] = [];

  for (const newText of newClaimTexts) {
    for (const old of existing) {
      if (claimsConflict(newText, old.claimText)) {
        hits.push({
          claimAId: old.id,
          claimBId: "__pending__",
          rationale: `New claim may contradict existing: "${old.claimText.slice(0, 120)}..."`,
        });
      }
    }
  }

  return hits;
}

export async function recordContradictions(
  conceptId: string,
  newClaimIds: string[],
  hits: ContradictionHit[],
): Promise<number> {
  let count = 0;
  for (const hit of hits) {
    if (hit.claimBId === "__pending__" && newClaimIds[0]) {
      const existing = await prisma.knowledgeContradiction.findFirst({
        where: {
          claimAId: hit.claimAId,
          claimBId: newClaimIds[0],
          status: "pending",
        },
      });
      if (existing) continue;
      await prisma.knowledgeContradiction.create({
        data: {
          claimAId: hit.claimAId,
          claimBId: newClaimIds[0],
          rationale: hit.rationale,
          status: "pending",
        },
      });
      count += 1;
    }
  }
  return count;
}

export async function hasPendingContradictionsForConcept(conceptId: string): Promise<boolean> {
  const n = await prisma.knowledgeContradiction.count({
    where: {
      status: "pending",
      OR: [{ claimA: { conceptId } }, { claimB: { conceptId } }],
    },
  });
  return n > 0;
}
