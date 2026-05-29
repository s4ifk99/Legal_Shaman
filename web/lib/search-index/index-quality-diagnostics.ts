import { buildTypesenseListingsClientFromEnv } from "@/lib/search/typesense-listings-client";
import { LEGAL_ENTITIES_COLLECTION } from "@/lib/search-index/config";

export type IndexQualityDiagnostics = {
  sampleSize: number;
  sraSampleSize: number;
  fieldPopulation: Record<string, { populated: number; rate: number; avgTokenLength: number }>;
  sraFieldPopulation: Record<string, { populated: number; rate: number; avgTokenLength: number }>;
  emptyIssueAliases: number;
  emptyLegalTerms: number;
  emptyUserSearchText: number;
  sraEmptyIssueAliases: number;
  sraEmptyLegalTerms: number;
  sraEmptyUserSearchText: number;
  sraNoLegalTerms: number;
  weakDocuments: { id: string; title: string; score: number; source: string }[];
  practiceAreaBySource: Record<string, number>;
};

const TRACKED_FIELDS = [
  "userSearchText",
  "legalSearchText",
  "issueAliases",
  "legalTerms",
  "userPhrases",
  "capabilitySearchText",
] as const;

function tokenCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

const MAX_SAMPLE = 250;

export async function collectIndexQualityDiagnostics(
  sampleSize = 250,
): Promise<IndexQualityDiagnostics | null> {
  const perPage = Math.min(sampleSize, MAX_SAMPLE);
  const client = buildTypesenseListingsClientFromEnv();
  if (!client) return null;

  const fetchSample = async (filterBy?: string) => {
    const res = await client
      .collections(LEGAL_ENTITIES_COLLECTION)
      .documents()
      .search({
        q: "*",
        query_by: "title",
        filter_by: filterBy,
        per_page: perPage,
      });
    return (res as { hits?: { document?: Record<string, unknown> }[] }).hits ?? [];
  };

  const hits = await fetchSample();
  const sraHits = await fetchSample("entityType:=`sra_organisation`");
  const n = hits.length || 1;
  const sraN = sraHits.length || 1;

  const initPopulation = (): IndexQualityDiagnostics["fieldPopulation"] => {
    const fieldPopulation: IndexQualityDiagnostics["fieldPopulation"] = {};
    for (const field of TRACKED_FIELDS) {
      fieldPopulation[field] = { populated: 0, rate: 0, avgTokenLength: 0 };
    }
    return fieldPopulation;
  };

  const fieldPopulation = initPopulation();
  const sraFieldPopulation = initPopulation();

  let emptyIssueAliases = 0;
  let emptyLegalTerms = 0;
  let emptyUserSearchText = 0;
  let sraEmptyIssueAliases = 0;
  let sraEmptyLegalTerms = 0;
  let sraEmptyUserSearchText = 0;
  let sraNoLegalTerms = 0;
  const weakDocuments: IndexQualityDiagnostics["weakDocuments"] = [];
  const practiceAreaBySource: Record<string, number> = {};

  const processHits = (
    batch: { document?: Record<string, unknown> }[],
    population: IndexQualityDiagnostics["fieldPopulation"],
    opts: { countGlobalEmpty?: boolean; countSraEmpty?: boolean },
  ) => {
    for (const h of batch) {
      const d = h.document ?? {};
      const source = String(d.source ?? "unknown");

      for (const field of TRACKED_FIELDS) {
        const val = d[field];
        const text = typeof val === "string" ? val : Array.isArray(val) ? val.join(" ") : "";
        if (text.trim().length > 2) {
          population[field].populated += 1;
          population[field].avgTokenLength += tokenCount(text);
        }
      }

      const issueAliases = Array.isArray(d.issueAliases) ? (d.issueAliases as string[]) : [];
      const legalTerms = Array.isArray(d.legalTerms) ? (d.legalTerms as string[]) : [];
      const userSearchText = String(d.userSearchText ?? "");

      if (opts.countGlobalEmpty) {
        if (issueAliases.length === 0) emptyIssueAliases++;
        if (legalTerms.length === 0) emptyLegalTerms++;
        if (userSearchText.trim().length < 8) emptyUserSearchText++;
      }
      if (opts.countSraEmpty && d.entityType === "sra_organisation") {
        if (issueAliases.length === 0) sraEmptyIssueAliases++;
        if (legalTerms.length === 0) sraEmptyLegalTerms++;
        if (userSearchText.trim().length < 8) sraEmptyUserSearchText++;
        if (legalTerms.length === 0) sraNoLegalTerms++;
      }

      const slugs = Array.isArray(d.practiceAreaSlugs) ? (d.practiceAreaSlugs as string[]) : [];
      if (slugs.length > 0) {
        practiceAreaBySource[source] = (practiceAreaBySource[source] ?? 0) + 1;
      }

      const score = Number(d.indexQualityScore ?? 0);
      if (score < 0.35) {
        weakDocuments.push({
          id: String(d.id ?? ""),
          title: String(d.title ?? "").slice(0, 60),
          score,
          source,
        });
      }
    }
  };

  processHits(hits, fieldPopulation, { countGlobalEmpty: true });
  processHits(sraHits, sraFieldPopulation, { countSraEmpty: true });

  const finalizePopulation = (
    population: IndexQualityDiagnostics["fieldPopulation"],
    total: number,
  ) => {
    for (const field of TRACKED_FIELDS) {
      const fp = population[field];
      fp.rate = Math.round((fp.populated / total) * 100) / 100;
      fp.avgTokenLength =
        fp.populated > 0 ? Math.round((fp.avgTokenLength / fp.populated) * 10) / 10 : 0;
    }
  };

  finalizePopulation(fieldPopulation, n);
  finalizePopulation(sraFieldPopulation, sraN);

  weakDocuments.sort((a, b) => a.score - b.score);

  return {
    sampleSize: hits.length,
    sraSampleSize: sraHits.length,
    fieldPopulation,
    sraFieldPopulation,
    emptyIssueAliases,
    emptyLegalTerms,
    emptyUserSearchText,
    sraEmptyIssueAliases,
    sraEmptyLegalTerms,
    sraEmptyUserSearchText,
    sraNoLegalTerms,
    weakDocuments: weakDocuments.slice(0, 20),
    practiceAreaBySource,
  };
}
