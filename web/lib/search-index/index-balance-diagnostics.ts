import { buildTypesenseListingsClientFromEnv } from "@/lib/search/typesense-listings-client";
import { LEGAL_ENTITIES_COLLECTION } from "@/lib/search-index/config";
import { sourceDiversityTier, type SourceDiversityTier } from "@/lib/legal-search/source-diversity";

export type SraProjectionSample = {
  id: string;
  title: string;
  practiceAreaSlugs: string[];
  sraProjectionConfidence?: number;
  employmentProjectionConfidence?: number;
};

export type IndexBalanceReport = {
  totalDocuments: number;
  byEntityType: Record<string, number>;
  bySource: Record<string, number>;
  byPracticeAreaSlug: Record<string, number>;
  byFundingRoute: Record<string, number>;
  familyBySource: Record<string, number>;
  familyPrivateFacingCount: number;
  familySraCount: number;
  familyDivorcePrivateCount: number;
  legalAidOnlySlugCount: number;
  sraByPracticeAreaSlug: Record<string, number>;
  sraProjectionSamples: SraProjectionSample[];
  sraProjectionConfidenceRange: { min: number; max: number } | null;
  employmentProjectionSamples: SraProjectionSample[];
  employmentProjectionConfidenceRange: { min: number; max: number } | null;
};

const SRA_VERIFY_SLUGS = [
  "family",
  "immigration",
  "employment",
  "housing",
  "criminal_defence",
  "prison_law",
] as const;

const ENTITY_TYPES = [
  "lawyer",
  "firm",
  "sra_organisation",
  "legal_aid_provider",
  "curated_listing",
  "pro_bono_organisation",
  "law_centre",
  "advice_charity",
  "university_law_clinic",
] as const;

const SOURCES = ["lawyer", "firm", "sra", "legal_aid", "curated_listing", "probono"] as const;

const FUNDING_ROUTES = ["pro_bono", "legal_aid", "private"] as const;

const TOP_SLUGS = [
  "family",
  "employment",
  "housing",
  "immigration",
  "criminal_defence",
  "welfare_benefits",
  "personal_injury",
  "prison_law",
] as const;

async function countFilter(filterBy: string): Promise<number> {
  const client = buildTypesenseListingsClientFromEnv();
  if (!client) return 0;
  try {
    const res = await client
      .collections(LEGAL_ENTITIES_COLLECTION)
      .documents()
      .search({
        q: "*",
        query_by: "title",
        filter_by: filterBy,
        per_page: 0,
      });
    return Number((res as { found?: number }).found ?? 0);
  } catch {
    return 0;
  }
}

function tierToFundingRoute(tier: SourceDiversityTier): string {
  if (tier === "legal_aid") return "legal_aid";
  if (tier === "pro_bono") return "pro_bono";
  return "private";
}

/** Aggregate index balance for verify + runtime coverage checks. */
export async function collectIndexBalanceReport(): Promise<IndexBalanceReport | null> {
  const client = buildTypesenseListingsClientFromEnv();
  if (!client) return null;

  let totalDocuments = 0;
  try {
    const col = await client.collections(LEGAL_ENTITIES_COLLECTION).retrieve();
    totalDocuments = Number((col as { num_documents?: number }).num_documents ?? 0);
  } catch {
    return null;
  }

  const byEntityType: Record<string, number> = {};
  for (const et of ENTITY_TYPES) {
    byEntityType[et] = await countFilter(`entityType:=\`${et}\``);
  }

  const bySource: Record<string, number> = {};
  for (const src of SOURCES) {
    bySource[src] = await countFilter(`source:=\`${src}\``);
  }

  const byPracticeAreaSlug: Record<string, number> = {};
  for (const slug of TOP_SLUGS) {
    byPracticeAreaSlug[slug] = await countFilter(`practiceAreaSlugs:=\`${slug}\``);
  }

  const byFundingRoute: Record<string, number> = {
    pro_bono: await countFilter(
      "entityType:=[`pro_bono_organisation`,`law_centre`,`advice_charity`,`university_law_clinic`]",
    ),
    legal_aid: await countFilter("entityType:=`legal_aid_provider`"),
    private: await countFilter(
      "entityType:=[`lawyer`,`firm`,`sra_organisation`,`curated_listing`]",
    ),
  };

  const familyPrivateFilter =
    "entityType:=[`lawyer`,`firm`,`sra_organisation`,`curated_listing`] && practiceAreaSlugs:=[`family`]";
  const familySraFilter =
    "entityType:=`sra_organisation` && practiceAreaSlugs:=[`family`]";
  const familyDivorceFilter =
    "entityType:=[`lawyer`,`firm`,`sra_organisation`,`curated_listing`] && (practiceAreaSlugs:=[`family`] || searchText:divorce)";

  const familyPrivateFacingCount = await countFilter(familyPrivateFilter);
  const familySraCount = await countFilter(familySraFilter);
  const familyDivorcePrivateCount = await countFilter(familyDivorceFilter);

  const familyBySource: Record<string, number> = {};
  for (const src of SOURCES) {
    familyBySource[src] = await countFilter(
      `practiceAreaSlugs:=[\`family\`] && source:=\`${src}\``,
    );
  }

  const sraByPracticeAreaSlug: Record<string, number> = {};
  for (const slug of SRA_VERIFY_SLUGS) {
    sraByPracticeAreaSlug[slug] = await countFilter(
      `entityType:=\`sra_organisation\` && practiceAreaSlugs:=\`${slug}\``,
    );
  }

  const sraProjectionSamples: SraProjectionSample[] = [];
  let confMin = Number.POSITIVE_INFINITY;
  let confMax = 0;
  try {
    const sampleRes = await client
      .collections(LEGAL_ENTITIES_COLLECTION)
      .documents()
      .search({
        q: "*",
        query_by: "title",
        filter_by: "entityType:=`sra_organisation` && practiceAreaSlugs:=[`family`]",
        per_page: 5,
        sort_by: "sraProjectionConfidence:desc",
      });
    const hits = (sampleRes as { hits?: { document?: Record<string, unknown> }[] }).hits ?? [];
    for (const h of hits) {
      const d = h.document;
      if (!d) continue;
      const conf = Number(d.sraProjectionConfidence ?? 0);
      if (conf > 0) {
        confMin = Math.min(confMin, conf);
        confMax = Math.max(confMax, conf);
      }
      sraProjectionSamples.push({
        id: String(d.id ?? ""),
        title: String(d.title ?? ""),
        practiceAreaSlugs: Array.isArray(d.practiceAreaSlugs)
          ? (d.practiceAreaSlugs as string[])
          : [],
        sraProjectionConfidence: conf > 0 ? conf : undefined,
      });
    }
  } catch {
    // optional field may be missing on older index schema
  }

  const sraProjectionConfidenceRange =
    sraProjectionSamples.length > 0 && Number.isFinite(confMin)
      ? { min: Math.round(confMin * 100) / 100, max: Math.round(confMax * 100) / 100 }
      : null;

  const employmentProjectionSamples: SraProjectionSample[] = [];
  let empConfMin = Number.POSITIVE_INFINITY;
  let empConfMax = 0;
  try {
    const empSampleRes = await client
      .collections(LEGAL_ENTITIES_COLLECTION)
      .documents()
      .search({
        q: "*",
        query_by: "title",
        filter_by: "entityType:=`sra_organisation` && practiceAreaSlugs:=[`employment`]",
        per_page: 5,
        sort_by: "employmentProjectionConfidence:desc",
      });
    const empHits =
      (empSampleRes as { hits?: { document?: Record<string, unknown> }[] }).hits ?? [];
    for (const h of empHits) {
      const d = h.document;
      if (!d) continue;
      const conf = Number(d.employmentProjectionConfidence ?? d.sraProjectionConfidence ?? 0);
      if (conf > 0) {
        empConfMin = Math.min(empConfMin, conf);
        empConfMax = Math.max(empConfMax, conf);
      }
      employmentProjectionSamples.push({
        id: String(d.id ?? ""),
        title: String(d.title ?? ""),
        practiceAreaSlugs: Array.isArray(d.practiceAreaSlugs)
          ? (d.practiceAreaSlugs as string[])
          : [],
        employmentProjectionConfidence: conf > 0 ? conf : undefined,
      });
    }
  } catch {
    // optional field may be missing on older index schema
  }

  const employmentProjectionConfidenceRange =
    employmentProjectionSamples.length > 0 && Number.isFinite(empConfMin)
      ? { min: Math.round(empConfMin * 100) / 100, max: Math.round(empConfMax * 100) / 100 }
      : null;

  let legalAidOnlySlugCount = 0;
  for (const slug of TOP_SLUGS) {
    if (slug === "family") continue;
    const total = byPracticeAreaSlug[slug] ?? 0;
    if (total === 0) continue;
    const privateCount = await countFilter(
      `practiceAreaSlugs:=\`${slug}\` && entityType:=[\`lawyer\`,\`firm\`,\`sra_organisation\`,\`curated_listing\`]`,
    );
    if (privateCount === 0 && total > 0) legalAidOnlySlugCount++;
  }

  return {
    totalDocuments,
    byEntityType,
    bySource,
    byPracticeAreaSlug,
    byFundingRoute,
    familyBySource,
    familyPrivateFacingCount,
    familySraCount,
    familyDivorcePrivateCount,
    legalAidOnlySlugCount,
    sraByPracticeAreaSlug,
    sraProjectionSamples,
    sraProjectionConfidenceRange,
    employmentProjectionSamples,
    employmentProjectionConfidenceRange,
  };
}

export function fundingRouteFromEntityType(entityType: string, source: string): string {
  const mock = {
    raw: { entityType },
    source,
  } as import("@/lib/legal-search/types").SearchResult;
  return tierToFundingRoute(sourceDiversityTier(mock));
}
