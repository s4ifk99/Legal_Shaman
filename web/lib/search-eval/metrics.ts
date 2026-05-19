import { LEGAL_ISSUE_TAXONOMY } from "@/lib/legal/legal-issue-taxonomy-data";
import type { SearchEvalCase, EvalRetrievedHit } from "@/lib/search-eval/types";

const EXPLANATION_BANNED = /\b(best|guarantee|will win|should\s|must\s|legal advice)\b/i;

const bySlug = new Map(LEGAL_ISSUE_TAXONOMY.map((e) => [e.slug, e]));

function hayIncludes(hay: string, term: string): boolean {
  const t = term.trim().toLowerCase();
  return t.length >= 3 && hay.includes(t);
}

function practiceAreaMatchesSlug(slug: string, practiceAreas: string[], hay: string): boolean {
  const entry = bySlug.get(slug);
  const labels = [
    slug.replace(/_/g, " "),
    entry?.canonicalName ?? "",
    ...(entry?.aliases ?? []),
    ...(entry?.relatedPracticeAreas ?? []),
  ].filter(Boolean);
  const lowerAreas = practiceAreas.map((p) => p.toLowerCase());
  for (const label of labels) {
    const l = label.toLowerCase();
    if (lowerAreas.some((p) => p.includes(l) || l.includes(p))) return true;
    if (hayIncludes(hay, l)) return true;
  }
  return false;
}

function sourceMatches(hit: { source: string; entityType?: string }, required: string): boolean {
  const r = required.toLowerCase();
  const src = hit.source.toLowerCase();
  const et = (hit.entityType ?? "").toLowerCase();
  if (r === "legal_aid") return src === "legal_aid" || et.includes("legal_aid");
  if (r === "sra" || r === "sra_organisation") return src === "sra" || et.includes("sra");
  if (r === "lawyer") return src === "lawyer" || et.includes("lawyer");
  if (r === "curated" || r === "curated_listing") return src === "curated_listing";
  if (r === "firm") return src === "firm";
  return src.includes(r) || et.includes(r);
}

/** LegalBench-RAG-style relevance: any listed signal is sufficient. */
export function gradeRelevance(
  hit: Omit<EvalRetrievedHit, "relevant" | "relevanceReasons" | "rank">,
  testCase: SearchEvalCase,
): { relevant: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const hay = hit.haystack.toLowerCase();

  const slugs = [
    testCase.expectedTaxonomySlug,
    ...(testCase.acceptableTaxonomySlugs ?? []),
  ].filter(Boolean) as string[];

  for (const slug of slugs) {
    if (practiceAreaMatchesSlug(slug, hit.practiceAreas, hay)) {
      reasons.push(`taxonomy:${slug}`);
      break;
    }
  }

  if (testCase.expectedPracticeAreas?.length) {
    for (const area of testCase.expectedPracticeAreas) {
      if (hayIncludes(hay, area)) {
        reasons.push(`practice_area:${area}`);
        break;
      }
    }
  }

  if (testCase.requiredTermsAny?.length) {
    for (const term of testCase.requiredTermsAny) {
      if (hayIncludes(hay, term)) {
        reasons.push(`term:${term}`);
        break;
      }
    }
  }

  if (testCase.requiredSourcesAny?.length) {
    for (const src of testCase.requiredSourcesAny) {
      if (sourceMatches(hit, src)) {
        reasons.push(`source:${src}`);
        break;
      }
    }
  }

  if (testCase.acceptableEntityTypes?.length) {
    const etHay = (hit.entityType ?? hit.source).toLowerCase();
    for (const et of testCase.acceptableEntityTypes) {
      const a = et.toLowerCase();
      if (etHay.includes(a) || a.includes(etHay)) {
        reasons.push(`entity_type:${et}`);
        break;
      }
    }
  }

  return { relevant: reasons.length > 0, reasons };
}

export function explanationPassesSafety(explanation: string): boolean {
  const t = explanation.trim();
  if (!t) return false;
  return !EXPLANATION_BANNED.test(t);
}

export function taxonomyMatchesExpected(
  parsedSlug: string | null | undefined,
  testCase: SearchEvalCase,
): boolean {
  if (!testCase.expectedTaxonomySlug) return true;
  if (!parsedSlug) return false;
  if (parsedSlug === testCase.expectedTaxonomySlug) return true;
  return (testCase.acceptableTaxonomySlugs ?? []).includes(parsedSlug);
}

export function precisionAtK(hits: EvalRetrievedHit[], k: number): number {
  const top = hits.slice(0, k);
  if (!top.length) return 0;
  return top.filter((h) => h.relevant).length / top.length;
}

export function recallAtK(hits: EvalRetrievedHit[], k: number, minRelevant: number): number {
  const relevant = hits.slice(0, k).filter((h) => h.relevant).length;
  const denom = Math.max(1, minRelevant);
  return Math.min(1, relevant / denom);
}

export function mrr(hits: EvalRetrievedHit[]): number {
  const idx = hits.findIndex((h) => h.relevant);
  if (idx < 0) return 0;
  return 1 / (idx + 1);
}

/** Binary-graded NDCG@K (no full corpus labels). */
export function ndcgLiteAtK(hits: EvalRetrievedHit[], k: number): number {
  const top = hits.slice(0, k);
  if (!top.length) return 0;

  const dcg = top.reduce((sum, h, i) => {
    const rel = h.relevant ? 1 : 0;
    return sum + rel / Math.log2(i + 2);
  }, 0);

  const idealCount = Math.min(k, top.filter((h) => h.relevant).length || 0);
  const idealRel = Math.max(idealCount, top.some((h) => h.relevant) ? 1 : 0);
  let idcg = 0;
  for (let i = 0; i < idealRel; i++) {
    idcg += 1 / Math.log2(i + 2);
  }
  if (idcg <= 0) return 0;
  return dcg / idcg;
}
