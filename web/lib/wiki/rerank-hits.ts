import { isPcnAppealQuery, isPropertyPurchaseMisrepresentationQuery, isRecordingLawQuery, isVehicleRepairQuery } from "@/lib/legal/query-signals";
import { resolveLegalIssueFromQuery } from "@/lib/legal/taxonomy";

import type { WikiSearchHit } from "./search";

const HOUSING_REPAIR_QUERY =
  /\b(housing association|social housing|council (home|house|tenant|housing)|disrepair|repairs?|landlord|leak|damp|mould|mold|bathroom|kitchen|awaab|hoarding|succession)\b/i;

const SHARED_HOUSING_QUERY =
  /\b(flatmate|housemate|lodger|subtenant|excluded occupier|share[d]?\s+accommodation|joint tenancy|notice to quit|renting with other)\b/i;

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
  consumer_vehicle_repair: "Consumer Rights",
  consumer_small_claims: "Courts and Disputes",
  criminal_defence: "Crime and Police",
  prison_law: "Crime and Police",
  neighbour_dispute: "Neighbours and Property",
  discrimination_equality: "Rights and Discrimination",
  parking_pcn: "Driving and Parking",
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
  consumer_vehicle_repair: [
    "problem with a car repair",
    "buying or repairing a car",
    "poor service",
    "poor workmanship",
    "faulty goods",
    "Motor Ombudsman",
  ],
  consumer_small_claims: ["small claims", "county court"],
  criminal_defence: ["police", "caution", "stop and search", "assault"],
  neighbour_dispute: ["neighbour", "boundary", "extension", "planning", "building regulations"],
  discrimination_equality: [
    "equality act",
    "protected characteristic",
    "discrimination",
    "goods and services",
    "sex discrimination",
  ],
  parking_pcn: [
    "appealing a parking ticket",
    "when to appeal a parking ticket",
    "penalty charge notice",
    "council PCN",
    "London Tribunals",
  ],
  conveyancing: ["conveyancing", "buying a house", "property purchase", "property misrepresentation", "estate agent"],
};

const RECORDING_QUERY =
  /\b(film(ing)?|photograph|cctv|privacy|record(ing|ed)? (someone|me|without)|without .{0,20}consent|illegal to record)\b/i;
const CUSTOMS_QUERY =
  /\b(customs|import|bringing .{0,40} into (the )?uk|border|prohibited|restricted item)\b/i;
const NEIGHBOUR_QUERY =
  /\b(neighbour|neighbor|extension|boundary|fence|building reg|planning permission)\b/i;
const UNSAFE_PRODUCT_QUERY =
  /\b(temu|amazon|ebay|aliexpress|marketplace|seller|bought online|purchased online|unsafe product|dangerous product|faulty goods|trading standards|consumer service|product recall|report this|report them|who do i report|lead test|lead contamination|tap[s]?\b|water fitting|drinking water contamination)\b/i;
const EQUALITY_SERVICES_QUERY =
  /\b(equality act|discriminat|protected characteristic|sex discrimination|indirect discrimination)\b/i;
const SERVICES_PROVIDER_CONTEXT_QUERY =
  /\b(gym|leisure|sauna|steam room|shower|changing room|cubicle|customer|clientele|member|membership|service provider|goods and services|shop|restaurant|hotel|club|facility|facilities)\b/i;

function isEqualityServicesRerankQuery(query: string): boolean {
  return (
    EQUALITY_SERVICES_QUERY.test(query) &&
    (SERVICES_PROVIDER_CONTEXT_QUERY.test(query) ||
      /\bgym|leisure|sauna|shower|changing room\b/i.test(query))
  );
}

function isUnsafeMarketplaceProductQuery(query: string): boolean {
  return UNSAFE_PRODUCT_QUERY.test(query);
}

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

  if (isPcnAppealQuery(query)) {
    anchors.push(
      "appealing a parking ticket",
      "when to appeal a parking ticket",
      "stop being chased for a parking ticket",
      "penalty charge notice council PCN",
      "London Tribunals parking appeal",
    );
  }
  if (isVehicleRepairQuery(query)) {
    anchors.push(
      "problem with a car repair",
      "buying or repairing a car",
      "if you're unhappy about poor service",
      "poor workmanship",
      "problems with services or traders",
      "letter to complain about the poor standard of a service",
      "faulty goods",
      "something's gone wrong with a purchase",
    );
  }
  if (isPropertyPurchaseMisrepresentationQuery(query)) {
    anchors.push(
      "property misrepresentation claims",
      "buying and selling a home",
      "types of misrepresentation",
      "what to do if your house sale falls through",
      "complaining about estate agent",
      "leasehold service charges",
    );
  }
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
  if (isRecordingLawQuery(query) && !isVehicleRepairQuery(query)) {
    anchors.push("record someone without consent", "filming", "privacy");
  }
  if (CUSTOMS_QUERY.test(lower)) {
    anchors.push("customs", "import", "bringing goods into the UK", "prohibited items");
  }
  if (NEIGHBOUR_QUERY.test(lower)) {
    anchors.push("neighbour dispute", "boundary", "extension", "building regulations");
  }
  if (UNSAFE_PRODUCT_QUERY.test(lower)) {
    anchors.push(
      "reporting to trading standards",
      "unsafe product",
      "faulty goods",
      "something's gone wrong with a purchase",
      "claim compensation if an item or product causes damage",
      "consumer service",
    );
  }
  if (isEqualityServicesRerankQuery(query)) {
    anchors.push(
      "taking action about discrimination in goods and services",
      "protected characteristics discrimination equality act",
      "discrimination in goods and services",
      "equality act",
      "sex discrimination",
    );
  }
  if (!isUnsafeMarketplaceProductQuery(query)) {
    anchors.push(...housingRepairAnchors(query));
  }

  const resolution = resolveLegalIssueFromQuery(query);
  if (resolution) {
    anchors.push(resolution.canonicalName);
    anchors.push(...resolution.searchBoostTerms.slice(0, 8));
    anchors.push(...(SLUG_ANCHORS[resolution.taxonomySlug] ?? []));
    anchors.push(...(SLUG_ANCHORS[slugRoot(resolution.taxonomySlug)] ?? []));
  }

  return [...new Set(anchors.map((a) => a.trim()).filter((a) => a.length >= 3))];
}

function patternBoostForHit(query: string, hit: WikiSearchHit): number {
  const titleLower = hit.title.toLowerCase();
  let boost = 0;

  if (isRecordingLawQuery(query) && !isVehicleRepairQuery(query)) {
    if (/\b(record|filming|consent|cctv|privacy)\b/i.test(titleLower)) boost += 45;
    if (/\b(power of attorney|dementia|deport)\b/i.test(titleLower)) boost -= 70;
  }
  if (isPcnAppealQuery(query)) {
    if (/appealing a parking ticket|when to appeal a parking ticket/i.test(titleLower)) boost += 130;
    if (/stop being chased for a parking ticket|parking tickets/i.test(titleLower)) boost += 80;
    if (/working hours|working time|employment law|rights at work|grievance|holiday pay/i.test(titleLower)) {
      boost -= 140;
    }
    if (hit.category === "Driving and Parking") boost += 50;
    if (hit.category === "Work and Employment") boost -= 90;
  }
  if (isVehicleRepairQuery(query)) {
    if (/problem with a car repair|buying or repairing a car/i.test(titleLower)) boost += 120;
    if (/poor workmanship|unhappy about poor service|poor standard of a service/i.test(titleLower)) {
      boost += 90;
    }
    if (/problems with services or traders|faulty goods|gone wrong with a purchase/i.test(titleLower)) {
      boost += 70;
    }
    if (/water supply|grievance|employee monitoring|record someone|lawyer, a solicitor|discrimination/i.test(titleLower)) {
      boost -= 120;
    }
    if (hit.category === "Consumer Rights") boost += 40;
    if (hit.category === "Work and Employment") boost -= 80;
  }
  if (isPropertyPurchaseMisrepresentationQuery(query)) {
    if (/property misrepresentation/i.test(titleLower)) boost += 140;
    if (/buying and selling a home|buying a home/i.test(titleLower)) boost += 100;
    if (/misrepresentation/i.test(titleLower) && hit.category === "Home and Housing") boost += 80;
    if (/house sale falls through|sale falls through/i.test(titleLower)) boost += 70;
    if (/cladding|service charge|leasehold/i.test(titleLower)) boost += 40;
    if (/travel agent|business agent|distributor or agent|used car|repairing a car/i.test(titleLower)) {
      boost -= 130;
    }
    if (/consumer contracts.*regulations|cancel.*online|over the phone/i.test(titleLower)) boost -= 110;
    if (hit.category === "Home and Housing" && /buy|sell|property|misrepresent/i.test(titleLower)) {
      boost += 35;
    }
  }
  if (CUSTOMS_QUERY.test(query)) {
    if (/\b(customs|import|prohibited|restricted|bringing)\b/i.test(titleLower)) boost += 40;
    if (/\b(lending money|power of attorney)\b/i.test(titleLower)) boost -= 50;
  }
  if (NEIGHBOUR_QUERY.test(query)) {
    if (/\b(neighbour|boundary|extension|planning|building reg|party wall)\b/i.test(titleLower)) {
      boost += 40;
    }
    if (/\bparty wall\b/i.test(titleLower) && /\bextension|building regs?\b/i.test(query)) {
      boost += 55;
    }
    if (
      /\b(cannabis|noisy neighbour after 11|smoking)\b/i.test(titleLower) &&
      /\bextension|building regs?|party wall\b/i.test(query)
    ) {
      boost -= 80;
    }
  }
  if (/\b(cancel|cancelled|cancellation|tradesman|trader)\b/i.test(query)) {
    if (/\bcancel/i.test(titleLower)) boost += 45;
    if (/\b(trader|consumer|service)\b/i.test(titleLower)) boost += 20;
  }
  if (UNSAFE_PRODUCT_QUERY.test(query)) {
    if (/\b(trading standards|consumer service|purchase|faulty goods|product causes damage)\b/i.test(titleLower)) {
      boost += 70;
    }
    if (/\b(landlord|repairs?|housing association|council tenant)\b/i.test(titleLower)) {
      boost -= 90;
    }
  }
  if (isEqualityServicesRerankQuery(query)) {
    if (/goods and services|discrimination in goods/i.test(titleLower)) boost += 80;
    if (/protected characteristics|equality act/i.test(titleLower)) boost += 55;
    if (/taking action about discrimination/i.test(titleLower) && !/\bat work\b/i.test(titleLower)) {
      boost += 45;
    }
    if (/\bat work\b|workplace|consultant solicitor|employment tribunal/i.test(titleLower)) {
      boost -= 90;
    }
  }

  return boost;
}

function hasPatternRerank(query: string): boolean {
  return (
    isVehicleRepairQuery(query) ||
    isPcnAppealQuery(query) ||
    isPropertyPurchaseMisrepresentationQuery(query) ||
    isRecordingLawQuery(query) ||
    RECORDING_QUERY.test(query) ||
    CUSTOMS_QUERY.test(query) ||
    NEIGHBOUR_QUERY.test(query) ||
    UNSAFE_PRODUCT_QUERY.test(query) ||
    isEqualityServicesRerankQuery(query) ||
    /\b(cancel|cancelled|cancellation|tradesman|trader)\b/i.test(query)
  );
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
  if (!resolution) {
    if (!hasPatternRerank(query)) return hits;
    return [...hits]
      .map((hit) => ({
        hit,
        score: hit.score + patternBoostForHit(query, hit) + (hit.id.startsWith("Directory/Firms/") ? -35 : 0),
      }))
      .sort((a, b) => b.score - a.score)
      .map((row) => ({ ...row.hit, score: row.score }));
  }

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

      boost += patternBoostForHit(query, hit);

      return { hit, score: hit.score + boost };
    })
    .sort((a, b) => b.score - a.score)
    .map((row) => ({ ...row.hit, score: row.score }));
}

export function housingRepairAnchors(query: string): string[] {
  if (isUnsafeMarketplaceProductQuery(query) || !HOUSING_REPAIR_QUERY.test(query)) return [];
  return [
    "getting repairs done housing association",
    "check if your landlord has to do repairs",
    "social housing tenant repairs",
    "housing disrepair",
    "complaining landlord failure repairs social housing",
  ];
}

export function isSharedHousingQuery(query: string): boolean {
  return SHARED_HOUSING_QUERY.test(query);
}

export function isHousingRepairQuery(query: string): boolean {
  if (isVehicleRepairQuery(query)) return false;
  if (isUnsafeMarketplaceProductQuery(query)) return false;
  // Flatmate / shared housing stories often say "joint tenancy" — that is not a repairs query
  if (isSharedHousingQuery(query) && !/\b(disrepair|repairs?|damp|mould|mold|leak)\b/i.test(query)) {
    return false;
  }
  return HOUSING_REPAIR_QUERY.test(query);
}

/** Prefer shared-accommodation / lodger / harassment pages; demote boundary neighbour noise. */
export function rerankSharedHousingHits(query: string, hits: WikiSearchHit[]): WikiSearchHit[] {
  const wantBroadband = /\b(wifi|wi-?fi|broadband|internet|password)\b/i.test(query)
  const wantHarassment = /\b(harass|threat|lash|camera|cctv|ring)\b/i.test(query)
  const wantMoney = /\b(rent|shortfall|owe|unpaid|letter before|lba|claim|contribution)\b/i.test(query)
  return stableSortWikiHits(
    hits.map((hit) => {
      let score = hit.score
      const title = hit.title.toLowerCase()
      const cat = (hit.category || '').toLowerCase()
      const id = hit.id.toLowerCase()
      const hay = `${title} ${id}`

      if (/check your rights if you share accommodation/.test(hay)) score += 160
      if (/renting with other people|excluded occupier|lodger/.test(hay)) score += 90
      if (/dispute a mobile|internet or tv bill/.test(hay)) score += 110
      if (/cancell.*(phone|internet|tv|mobile)/.test(hay)) score -= 100
      if (wantBroadband && /broadband|internet|phone|tv bill|mobile/.test(hay) && !/cancell/.test(hay)) {
        score += 70
      }
      if (wantMoney && /joint|rent|debt|contribution|letter before|small claim/.test(hay)) score += 55
      if (wantHarassment && /harass|camera|cctv|ico|threat/.test(hay)) score += 75
      if (/if someone.?s? harassed you in housing|check what you can do about harassment/.test(hay)) {
        score += 85
      }
      if (/home and housing/.test(cat) || /\/renting\//.test(id)) score += 35
      if (/boundary|party wall|encroachment|hedge|bamboo|extension|planning|seller lied/.test(title)) {
        score -= 120
      }
      if (/neighbours and property/.test(cat) && !/harass|cctv|camera|noise/.test(title)) score -= 70
      if (/shared ownership|share of freehold|rent-to-own|tenant abandonment/.test(title)) score -= 90
      if (/\bnda\b|non-disclosure|lasting power of attorney|wills and/.test(title)) score -= 150
      if (/no fault eviction|section 21/.test(title) && !/notice to quit|evict/.test(query.toLowerCase())) {
        score -= 40
      }
      if (/struggling to pay your phone|cancel your contract/.test(title)) score -= 40
      return { ...hit, score }
    }),
  )
}

export function shouldRerankWikiHits(query: string): boolean {
  if (isSharedHousingQuery(query)) return false;
  return (
    Boolean(resolveLegalIssueFromQuery(query)) ||
    isVehicleRepairQuery(query) ||
    isPcnAppealQuery(query) ||
    HOUSING_REPAIR_QUERY.test(query) ||
    hasPatternRerank(query)
  );
}

/** Drop employment / water-supply / recording collisions on garage & van stories. */
export function filterOffTopicVehicleHits(query: string, hits: WikiSearchHit[]): WikiSearchHit[] {
  if (!isVehicleRepairQuery(query)) return hits;
  return hits.filter((h) => {
    const t = h.title.toLowerCase();
    if (/water supply|turn off someone/.test(t)) return false;
    if (/grievance procedure|employee monitoring|problems at work/.test(t)) return false;
    if (/record someone without|differences between a lawyer/.test(t)) return false;
    if (/discrimination/.test(t) && !/goods and services/.test(t)) return false;
    if (/sole trader|vat registered|greenwashing/.test(t)) return false;
    return true;
  });
}

/** Drop employment / holiday pages when the live question is council PCNs. */
export function filterOffTopicPcnHits(query: string, hits: WikiSearchHit[]): WikiSearchHit[] {
  if (!isPcnAppealQuery(query)) return hits;
  return hits.filter((h) => {
    const t = h.title.toLowerCase();
    const cat = (h.category || "").toLowerCase();
    if (/working hours|working time|unsocial working|employment law|rights at work/.test(t)) {
      return false;
    }
    if (/grievance|employee monitoring|holiday pay|redundancy|unfair dismiss/.test(t)) return false;
    if (/work and employment/.test(cat) && !/parking|pcn|ticket|driving/.test(t)) return false;
    if (/first choice holidays|dies abroad|debt relief/.test(t)) return false;
    if (/notice of intended prosecution/.test(t) && !/nip|intended prosecution/i.test(query)) {
      return false;
    }
    if (/parking in front of your house/.test(t)) return false;
    if (/private property and driveways/.test(t) && !/private property|driveway/i.test(query)) {
      return false;
    }
    if (/blue badge/.test(t) && !/blue badge/i.test(query)) return false;
    return true;
  });
}

/** Drop travel/business-agent and used-car pages on flat purchase / estate-agent stories. */
export function filterOffTopicPropertyPurchaseHits(
  query: string,
  hits: WikiSearchHit[],
): WikiSearchHit[] {
  if (!isPropertyPurchaseMisrepresentationQuery(query)) return hits;
  return hits.filter((h) => {
    const t = h.title.toLowerCase();
    if (/travel agent|business agent|distributor or agent|asset sale vs share/.test(t)) return false;
    if (/used car|repairing a car|problem with a car|faulty used car/.test(t)) return false;
    if (/consumer contracts.*regulations|cancel.*online|over the phone or by post/.test(t)) {
      return false;
    }
    return true;
  });
}
