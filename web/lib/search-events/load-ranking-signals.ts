import "server-only";

import { prisma } from "@/lib/db/prisma";
import { entityBoostKey } from "@/lib/search-events/types";
import type { RankingSignalLite } from "@/lib/search-events/behavioural-boost";

type EntityRef = { id: string; source: string };

function signalSpecificity(
  row: { practiceArea: string; city: string },
  scope: { practiceArea?: string | null; city?: string | null },
): number {
  let score = 0;
  const scopePa = scope.practiceArea?.trim() || "";
  const scopeCity = scope.city?.trim() || "";
  if (row.practiceArea && scopePa && row.practiceArea === scopePa) score += 4;
  else if (!row.practiceArea) score += 1;
  if (row.city && scopeCity && row.city.toLowerCase() === scopeCity.toLowerCase()) score += 2;
  else if (!row.city) score += 1;
  return score;
}

export async function loadBehaviouralSignalsForEntities(
  entities: EntityRef[],
  scope: { practiceArea?: string | null; city?: string | null },
): Promise<Map<string, RankingSignalLite>> {
  const out = new Map<string, RankingSignalLite>();
  if (entities.length === 0) return out;

  const ids = [...new Set(entities.map((e) => e.id))];
  const sources = [...new Set(entities.map((e) => e.source))];

  const rows = await prisma.searchRankingSignal.findMany({
    where: {
      entityId: { in: ids },
      entitySource: { in: sources },
    },
  });

  for (const entity of entities) {
    const key = entityBoostKey(entity.source, entity.id);
    if (out.has(key)) continue;

    const candidates = rows.filter(
      (r) => r.entityId === entity.id && r.entitySource === entity.source,
    );
    if (!candidates.length) continue;

    candidates.sort(
      (a, b) =>
        signalSpecificity(b, scope) - signalSpecificity(a, scope) ||
        b.confidence - a.confidence,
    );
    const best = candidates[0]!;
    out.set(key, {
      ctr: best.ctr,
      contactRate: best.contactRate,
      confidence: best.confidence,
    });
  }

  return out;
}
