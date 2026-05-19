import "server-only";

import { prisma } from "@/lib/db/prisma";
import { lawyerInclude } from "@/lib/lawyers/db";
import type { Candidate, SraOrgLite } from "@/lib/lawyers/search";
import { enableTypesenseUnified } from "@/lib/legal-search/config";
import {
  buildFilterBy,
  searchLegalEntitiesForMatcher,
} from "@/lib/search-index/typesense-legal-entities-search";

export async function fetchTypesenseMatcherCandidates(args: {
  keyword: string;
  expandedQ: string;
  practiceArea?: string | null;
  city?: string | null;
  limit?: number;
}): Promise<Candidate[]> {
  if (!enableTypesenseUnified()) return [];

  const filterBy = buildFilterBy({
    practiceArea: args.practiceArea ?? undefined,
    city: args.city ?? undefined,
    entityTypes: ["lawyer", "sra_organisation"],
  });

  const hits = await searchLegalEntitiesForMatcher({
    expandedQ: args.expandedQ.trim() || args.keyword.trim(),
    limit: args.limit ?? 80,
    filterBy,
  });

  const lawyerIds: string[] = [];
  const sraKeys: string[] = [];

  for (const h of hits) {
    const id = String(h.document.id ?? "");
    if (id.startsWith("lawyer:")) lawyerIds.push(id.slice("lawyer:".length));
    else if (id.startsWith("sra:")) sraKeys.push(id.slice("sra:".length));
  }

  const out: Candidate[] = [];

  if (lawyerIds.length) {
    const unique = [...new Set(lawyerIds)].slice(0, 60);
    const rows = await prisma.lawyer.findMany({
      where: { id: { in: unique } },
      include: lawyerInclude,
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const id of unique) {
      const lawyer = byId.get(id);
      if (!lawyer) continue;
      out.push({
        kind: "lawyer",
        lawyer,
        sources: ["typesense"],
        cosineDistance: null,
      });
    }
  }

  if (sraKeys.length) {
    const unique = [...new Set(sraKeys)].slice(0, 60);
    const rows = await prisma.sraOrganisation.findMany({
      where: { sraId: { in: unique } },
    });
    const bySra = new Map(rows.map((r) => [r.sraId, r]));
    for (const sraId of unique) {
      const org = bySra.get(sraId);
      if (!org) continue;
      const lite: SraOrgLite = {
        id: org.id,
        sraId: org.sraId,
        businessName: org.businessName,
        city: org.city,
        postcode: org.postcode,
        county: org.county,
        country: org.country,
        sraProfileUrl: org.sraProfileUrl,
      };
      out.push({
        kind: "org",
        org: lite,
        sources: ["typesense"],
        cosineDistance: null,
      });
    }
  }

  return out;
}
