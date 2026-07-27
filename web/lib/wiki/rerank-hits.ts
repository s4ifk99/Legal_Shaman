import { resolveLegalIssueFromQuery } from "@/lib/legal/taxonomy";

import type { WikiSearchHit } from "./search";

const HOUSING_REPAIR_QUERY =
  /\b(housing association|social housing|council (home|house|tenant|housing)|disrepair|repairs?|landlord|leak|damp|mould|mold|bathroom|kitchen|joint tenant|co-?tenant|awaab|hoarding|succession)\b/i;

const FAMILY_COHAB_TITLE =
  /\b(living together|cohabitation|common law marriage|prenup|prenuptial|divorce|marriage contract)\b/i;

const OFF_TOPIC_FOR_HOUSING =
  /\b(visa|immigration|child contact|custody|employment|commission|small claim|parkingeye)\b/i;

const CATEGORY_BY_SLUG: Record<string, string> = {
  housing: "Home and Housing",
  conveyancing: "Home and Housing",
  employment: "Work and Employment",
  family: "Family and Relationships",
  immigration: "Immigration and Citizenship",
  debt: "Money Benefits and Debt",
  welfare_benefits: "Money Benefits and Debt",
  consumer: "Consumer Rights",
  consumer_services: "Consumer Rights",
  consumer_small_claims: "Courts and Disputes",
  criminal_defence: "Crime and Police",
  prison_law: "Crime and Police",
  neighbour_dispute: "Neighbours and Property",
  parking_pcn: "Consumer Rights",
  personal_injury: "Health and Injury",
};

const SLUG_ANCHORS: Record<string, string[]> = {
  housing: [
    "landlord repairs",
    "housing disrepair",
    "tenancy deposit",
    "section 21",
    "eviction",
  ],
  employment: ["unfair dismissal", "ACAS", "employment rights", "workplace", "pension auto enrolment"],
  family: ["child arrangements", "divorce", "domestic abuse", "contact order"],
  immigration: ["visa refusal", "immigration", "home office", "spouse visa"],
  debt: ["bailiff", "debt", "creditor", "CCJ"],
  welfare_benefits: ["universal credit", "benefits", "sanction"],
  consumer: ["consumer rights", "refund", "faulty goods", "customs", "import"],
  consumer_services: ["poor service", "trader", "cancellation"],
  consumer_small_claims: ["small claims", "county court"],
  criminal_defence: ["police", "caution", "stop and search", "assault"],
  neighbour_dispute: ["neighbour", "boundary", "extension", "planning", "building regulations"],
  parking_pcn: ["private parking", "parking charge notice"],
  conveyancing: ["conveyancing", "buying a house", "property purchase"],
};

const RECORDING_QUERY =
  /\b(film|filming|record(ing|ed)?|photograph|consent|cctv|privacy)\b/i;
const CUSTOMS_QUERY =
  /\b(customs|import|bringing .{0,40} into (the )?uk|border|prohibited|restricted item)\b/i;
const NEIGHBOUR_QUERY =
  /\b(neighbour|neighbor|extension|boundary|fence|building reg|planning permission)\b/i;

export function stableSortWikiHits(hits: WikiSearchHit[]): WikiSearchHit[] {
  return [...hits].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

function slugRoot(slug: string): string {
  if (CATEGORY_BY_SLUG[slug]) return slug;
  const root = slug.split("_")[0];
  return root ?? slug;
}

/** Search anchors from query signals + taxonomy (Reddit posts, long narratives). */
export function wikiAnchorsForQuery(query: string): string[] {
  const lower = query.toLowerCase();
  const anchors: string[] = [];

  if (/\b(cancel|cancelled|cancellation|owe|transfer|booking fee)\b/i.test(lower)) {
    anchors.push(
      "cancelling a service you've arranged",
      "cancellation rights",
      "cancel service",
      "problems with services or traders",
    );
  }
  if (/\b(tradesman|tiler|builder|plumber|electrician|trader|contractor)\b/i.test(lower)) {
    anchors.push("problems with services or traders", "poor service", "trader");
  }
  if (RECORDING_QUERY.test(lower)) {
    anchors.push("record someone without consent", "filming", "privacy");
  }
  if (CUSTOMS_QUERY.test(lower)) {
    anchors.push("customs", "import", "bringing goods into the UK", "prohibited items");
  }
  if (NEIGHBOUR_QUERY.test(lower)) {
    anchors.push("neighbour dispute", "boundary", "extension", "building regulations");
  }
  anchors.push(...housingRepairAnchors(query));

  const resolution = resolveLegalIssueFromQuery(query);
  if (resolution) {
    anchors.push(resolution.canonicalName);
    anchors.push(...resolution.searchBoostTerms.slice(0, 8));
    anchors.push(...(SLUG_ANCHORS[resolution.taxonomySlug] ?? []));
    anchors.push(...(SLUG_ANCHORS[slugRoot(resolution.taxonomySlug)] ?? []));
  }

  return [...new Set(anchors.map((a) => a.trim()).filter((a) => a.length >= 3))];
}

/** Prefer repair/HA pages and demote cohabitation hits when the query is about housing disrepair. */
export function rerankWikiHitsForQuery(query: string, hits: WikiSearchHit[]): WikiSearchHit[] {
  if (HOUSING_REPAIR_QUERY.test(query)) {
    return [...hits]
      .map((hit) => {
        const title = hit.title;
        let boost = 0;
        if (/\b(repair|disrepair|housing association|social housing|landlord|council)\b/i.test(title)) {
          boost += 55;
        }
        if (
          /\b(getting repairs|check if your landlord|complaining about your landlord)\b/i.test(title)
        ) {
          boost += 35;
        }
        if (hit.category === "Home and Housing") boost += 25;
        if (FAMILY_COHAB_TITLE.test(title)) boost -= 100;
        if (OFF_TOPIC_FOR_HOUSING.test(title)) boost -= 60;
        if (hit.id.startsWith("Directory/Firms/")) boost -= 40;
        return { hit, score: hit.score + boost };
      })
      .sort((a, b) => b.score - a.score)
      .map((row) => ({ ...row.hit, score: row.score }));
  }

  const resolution = resolveLegalIssueFromQuery(query);
  if (!resolution) return hits;

  const preferredCategory =
    CATEGORY_BY_SLUG[resolution.taxonomySlug] ??
    CATEGORY_BY_SLUG[slugRoot(resolution.taxonomySlug)];
  const boostTerms = [
    resolution.canonicalName,
    ...resolution.searchBoostTerms.slice(0, 8),
    ...(SLUG_ANCHORS[resolution.taxonomySlug] ?? []),
  ].map((t) => t.toLowerCase());

  return [...hits]
    .map((hit) => {
      const titleLower = hit.title.toLowerCase();
      const summaryLower = `${hit.summary} ${hit.category}`.toLowerCase();
      let boost = 0;

      if (preferredCategory && hit.category === preferredCategory) boost += 35;
      for (const term of boostTerms) {
        if (term.length >= 4 && titleLower.includes(term)) boost += 10;
        else if (term.length >= 4 && summaryLower.includes(term)) boost += 4;
      }

      // Housing queries that mention living with relatives — not cohabitation law.
      if (
        resolution.taxonomySlug === "housing" ||
        /\b(repair|landlord|tenant|housing association)\b/i.test(query)
      ) {
        if (FAMILY_COHAB_TITLE.test(hit.title)) boost -= 90;
      }

      if (hit.id.startsWith("Directory/Firms/")) boost -= 35;
      if (/\b(practice direction|part 48)\b/i.test(hit.title)) boost -= 50;

      if (RECORDING_QUERY.test(query)) {
        if (/\b(record|filming|consent|cctv|privacy)\b/i.test(titleLower)) boost += 45;
        if (/\b(power of attorney|dementia|deport)\b/i.test(titleLower)) boost -= 70;
      }
      if (CUSTOMS_QUERY.test(query)) {
        if (/\b(customs|import|prohibited|restricted|bringing)\b/i.test(titleLower)) boost += 40;
      }
      if (NEIGHBOUR_QUERY.test(query)) {
        if (/\b(neighbour|boundary|extension|planning|building reg|party wall)\b/i.test(titleLower)) {
          boost += 40;
        }
        if (/\bnoisy neighbour after 11\b/i.test(titleLower) && /\bextension|building reg\b/i.test(query)) {
          boost -= 30;
        }
      }

      return { hit, score: hit.score + boost };
    })
    .sort((a, b) => b.score - a.score)
    .map((row) => ({ ...row.hit, score: row.score }));
}

export function housingRepairAnchors(query: string): string[] {
  if (!HOUSING_REPAIR_QUERY.test(query)) return [];
  return [
    "getting repairs done housing association",
    "check if your landlord has to do repairs",
    "social housing tenant repairs",
    "housing disrepair",
    "complaining landlord failure repairs social housing",
  ];
}

export function isHousingRepairQuery(query: string): boolean {
  return HOUSING_REPAIR_QUERY.test(query);
}

export function shouldRerankWikiHits(query: string): boolean {
  return Boolean(resolveLegalIssueFromQuery(query)) || HOUSING_REPAIR_QUERY.test(query);
}
