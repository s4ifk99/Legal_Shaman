import { readFileSync } from "node:fs";

import { prisma } from "@/lib/db/prisma";

import { backfillConceptGraphFromWikiIndex } from "./concept-graph";
import { detectContradictions, recordContradictions } from "./contradiction-detector";
import { extractSourceClaims } from "./extract-source";
import { buildMergePlan } from "./merge-plan";
import { matchClaimsToConcepts } from "./match-concepts";
import { applyMergePlan } from "./wiki-writer";
import { buildWikiIndex } from "@/lib/wiki/build-index";

export type IntegrateSourceInput = {
  rawText: string;
  sourceUrl?: string;
  sourceType?: string;
  dryRun?: boolean;
};

export type IntegrateSourceResult = {
  runId: string;
  claimsCreated: number;
  contradictions: number;
  mergeActions: number;
  written: string[];
  blocked: boolean;
  errors: string[];
};

export async function integrateSource(input: IntegrateSourceInput): Promise<IntegrateSourceResult> {
  const run = await prisma.knowledgeIntegrationRun.create({
    data: {
      sourceUrl: input.sourceUrl ?? null,
      sourceType: input.sourceType ?? "raw_text",
      status: "running",
    },
  });

  const errors: string[] = [];
  let claimsCreated = 0;
  let contradictionCount = 0;
  let blocked = false;

  try {
    const extracted = await extractSourceClaims(input.rawText, input.sourceUrl);
    const matched = await matchClaimsToConcepts(extracted);

    const conceptIds = new Set(matched.map((m) => m.conceptId).filter(Boolean) as string[]);
    for (const conceptId of conceptIds) {
      const newTexts = matched.filter((m) => m.conceptId === conceptId).map((m) => m.claimText);
      const hits = await detectContradictions(conceptId, newTexts);
      if (hits.length) {
        blocked = true;
        const newClaim = await prisma.knowledgeClaim.create({
          data: {
            conceptId,
            claimText: newTexts[0]!.slice(0, 2000),
            sectionTarget: matched.find((m) => m.conceptId === conceptId)?.sectionTarget ?? null,
            sourceUrl: input.sourceUrl ?? null,
          },
        });
        claimsCreated += 1;
        contradictionCount += await recordContradictions(conceptId, [newClaim.id], hits);
      }
    }

    const mergeActions = buildMergePlan(extracted, matched);
    let written: string[] = [];
    let conceptsCreated = 0;

    if (!input.dryRun && !blocked) {
      const writeResult = applyMergePlan(mergeActions);
      written = writeResult.written;
      errors.push(...writeResult.errors);
      try {
        buildWikiIndex();
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
      const backfill = await backfillConceptGraphFromWikiIndex();
      conceptsCreated = backfill.conceptsUpserted;
    }

    for (const claim of matched) {
      if (!claim.conceptId || blocked) continue;
      const exists = await prisma.knowledgeClaim.findFirst({
        where: { conceptId: claim.conceptId, claimText: claim.claimText.slice(0, 2000) },
      });
      if (exists) continue;
      await prisma.knowledgeClaim.create({
        data: {
          conceptId: claim.conceptId,
          claimText: claim.claimText.slice(0, 2000),
          sectionTarget: claim.sectionTarget ?? null,
          sourceUrl: input.sourceUrl ?? null,
        },
      });
      claimsCreated += 1;
    }

    await prisma.knowledgeIntegrationRun.update({
      where: { id: run.id },
      data: {
        status: blocked ? "blocked" : "completed",
        claimsCreated,
        contradictionCount,
        conceptsUpdated: written.length,
        conceptsCreated,
        completedAt: new Date(),
        errors: errors.length ? errors : undefined,
      },
    });

    return {
      runId: run.id,
      claimsCreated,
      contradictions: contradictionCount,
      mergeActions: mergeActions.length,
      written,
      blocked,
      errors,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(message);
    await prisma.knowledgeIntegrationRun.update({
      where: { id: run.id },
      data: { status: "failed", errors, completedAt: new Date() },
    });
    return {
      runId: run.id,
      claimsCreated,
      contradictions: contradictionCount,
      mergeActions: 0,
      written: [],
      blocked: true,
      errors,
    };
  }
}

export async function integrateSourceFromFile(
  filePath: string,
  opts?: { dryRun?: boolean },
): Promise<IntegrateSourceResult> {
  const rawText = readFileSync(filePath, "utf8");
  return integrateSource({
    rawText,
    sourceUrl: `file://${filePath}`,
    sourceType: "file",
    dryRun: opts?.dryRun,
  });
}
