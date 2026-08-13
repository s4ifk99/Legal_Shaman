/**
 * Advanced taxonomy resolver: question-vs-backdrop scoring, excludes, conflicts.
 * Used by wiki retrieve and Overview. Policy shared with the orchestrator TaxonomyAgent.
 */
import policy from "@/lib/legal/taxonomy-policy.json";
import {
  LEGAL_ISSUE_TAXONOMY,
  type LegalIssueTaxonomyEntry,
} from "@/lib/legal/legal-issue-taxonomy-data";
import { isPcnAppealQuery, isPropertyPurchaseMisrepresentationQuery, isVehicleRepairQuery } from "@/lib/legal/query-signals";
import {
  normalizePhrase,
  normalizePracticeAreas,
} from "@/lib/provider-crawler/practice-area-normalizer";

export type TaxonomyCandidate = {
  slug: string;
  score: number;
  sources: string[];
};

export type TaxonomyResolution = {
  taxonomySlug: string;
  canonicalName: string;
  matcherSlug: string;
  relatedPracticeAreas: string[];
  expandedTerms: string[];
  clarificationQuestion: string | null;
  searchBoostTerms: string[];
  legalAidLikely: boolean;
  matchStrength: number;
  topicId: string;
  matterType: string;
  candidates: TaxonomyCandidate[];
  questionFocus: string;
  confidence: "high" | "medium" | "low";
  reason: string;
};

type Policy = {
  backdropCues: string[];
  employmentDisputeCues: string[];
  excludes: Record<string, string[]>;
  conflicts: { when: string; prefer: string; over: string[] }[];
  slugMap: Record<string, { matterType: string; topicId: string }>;
};

const POLICY = policy as Policy;
const bySlug = new Map(LEGAL_ISSUE_TAXONOMY.map((e) => [e.slug, e]));

const EXCLUDES: Record<string, RegExp[]> = Object.fromEntries(
  Object.entries(POLICY.excludes || {}).map(([slug, list]) => [
    slug,
    (list || []).map((s) => new RegExp(s, "i")),
  ]),
);

function uniqueLower(strings: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of strings) {
    const t = s.trim().toLowerCase();
    if (t.length < 2 || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function phraseIn(phrase: string, text: string): boolean {
  if (phrase.length < 2 || !text.includes(phrase)) return false;
  if (phrase.length >= 5) return true;
  return new RegExp(`(?:^|[^a-z0-9])${escapeRegex(phrase)}(?:[^a-z0-9]|$)`, "i").test(text);
}

function phrasesFor(entry: LegalIssueTaxonomyEntry): string[] {
  return uniqueLower([
    ...entry.aliases,
    ...entry.userPhrases,
    ...entry.subIssues,
    ...entry.searchBoostTerms,
    entry.canonicalName,
  ]).filter((p) => p.length >= 3 && !/^(solicitor|lawyers?|attorney)s?$/.test(p));
}

const PHRASES = new Map(LEGAL_ISSUE_TAXONOMY.map((e) => [e.slug, phrasesFor(e)] as const));

export function splitQuestionAndBackdrop(story: string, clientQuestion = "") {
  const text = story.trim();
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const qSentences = sentences.filter(
    (s) =>
      /[?]/.test(s) ||
      /^(are there|can |what |how |is there|grounds|should |do i|does he)\b/i.test(s.trim()),
  );
  const question = [clientQuestion, ...qSentences].filter(Boolean).join(" ").trim();
  const backdrop = sentences.filter((s) => !qSentences.includes(s)).join(" ").trim();
  return { question, backdrop: backdrop || text, full: text };
}

function employmentBackdropOnly(full: string): boolean {
  const lower = full.toLowerCase();
  const dispute = (POLICY.employmentDisputeCues || []).some((c) => lower.includes(c.toLowerCase()));
  const scene = (POLICY.backdropCues || []).some((c) => lower.includes(c.toLowerCase()));
  return scene && !dispute;
}

const DETECT = {
  pcn: (q: string) => isPcnAppealQuery(q),
  vehicle_repair: (q: string) => isVehicleRepairQuery(q),
  shared_housing: (q: string) =>
    /\b(flatmate|housemate|lodger|joint tenancy|share[d]?\s+accommodation)\b/i.test(q),
  housing_repair: (q: string) =>
    /\b(disrepair|damp|mould|mold|housing association|landlord.{0,24}repair)\b/i.test(q) &&
    !isVehicleRepairQuery(q),
  neighbour_access: (q: string) =>
    /\b(neighbour|neighbor).{0,40}(driveway|car\s*port|carport|blocking|access|right of way)\b/i.test(
      q,
    ) || /\b(car\s*port|carport|easement|right of way)\b/i.test(q),
  motoring_ban: (q: string) =>
    /\b(driving ban|disqualif|banned from driving|in charge of (?:a |the )?vehicle)\b/i.test(q),
  property_purchase: (q: string) => isPropertyPurchaseMisrepresentationQuery(q),
};

function isExcluded(slug: string, full: string): boolean {
  return (EXCLUDES[slug] || []).some((re) => re.test(full));
}

export function resolveTaxonomy(opts: {
  story: string;
  question?: string;
  understanding?: string;
}): TaxonomyResolution | null {
  const story = [opts.question, opts.understanding, opts.story].filter(Boolean).join("\n");
  const trimmed = story.trim();
  if (trimmed.length < 2) return null;

  const { question, full } = splitQuestionAndBackdrop(trimmed, opts.question || "");
  const qNorm = normalizePhrase(question || full);
  const fNorm = normalizePhrase(full);
  const detected = Object.fromEntries(
    Object.entries(DETECT).map(([k, fn]) => [k, fn(full)]),
  ) as Record<string, boolean>;

  const scores = new Map<string, number>();
  const sources = new Map<string, string[]>();
  const add = (slug: string, pts: number, why: string) => {
    if (!slug || pts <= 0 || isExcluded(slug, full)) return;
    scores.set(slug, (scores.get(slug) || 0) + pts);
    const list = sources.get(slug) || [];
    list.push(why);
    sources.set(slug, list);
  };

  for (const entry of LEGAL_ISSUE_TAXONOMY) {
    if (isExcluded(entry.slug, full)) continue;
    let qScore = 0;
    let bScore = 0;
    for (const ph of PHRASES.get(entry.slug) || []) {
      if (question && phraseIn(ph, qNorm)) qScore += ph.length * 2.4;
      else if (phraseIn(ph, fNorm)) bScore += ph.length;
    }
    const total = qScore + bScore;
    if (total > 0) add(entry.slug, total, qScore > bScore ? "question-phrases" : "story-phrases");
  }

  const lawyer = normalizePracticeAreas(trimmed);
  for (const slug of lawyer.canonicalSlugs) {
    if (lawyer.taxonomyConfidence < 0.62) continue;
    add(slug, 12 + lawyer.taxonomyConfidence * 24, "lawyer-intent");
  }

  if (detected.pcn) add("parking_pcn", 42, "detector:pcn");
  if (detected.vehicle_repair) add("consumer_vehicle_repair", 40, "detector:vehicle_repair");
  if (detected.shared_housing) add("housing", 36, "detector:shared_housing");
  if (detected.housing_repair) add("housing", 36, "detector:housing_repair");
  if (detected.neighbour_access) add("neighbour_dispute", 38, "detector:neighbour_access");
  if (detected.motoring_ban) add("criminal_defence", 42, "detector:motoring_ban");
  if (detected.property_purchase) add("conveyancing", 44, "detector:property_purchase");

  if (employmentBackdropOnly(full) && scores.has("employment")) {
    scores.set("employment", (scores.get("employment") || 0) * 0.12);
    sources.set("employment", [...(sources.get("employment") || []), "backdrop-penalised"]);
  }

  for (const rule of POLICY.conflicts || []) {
    if (!detected[rule.when]) continue;
    add(rule.prefer, 24, `conflict:${rule.when}`);
    for (const over of rule.over || []) {
      if (over === rule.prefer) continue;
      const cur = scores.get(over) || 0;
      if (cur > 0) {
        scores.set(over, cur * 0.15);
        sources.set(over, [...(sources.get(over) || []), `lost-to:${rule.prefer}`]);
      }
    }
  }

  const candidates = [...scores.entries()]
    .map(([slug, score]) => ({
      slug,
      score: Math.round(score * 10) / 10,
      sources: sources.get(slug) || [],
    }))
    .filter((c) => c.score >= 3)
    .sort((a, b) => b.score - a.score);

  const top = candidates[0];
  if (!top) return null;
  const entry = bySlug.get(top.slug);
  if (!entry) return null;

  const mapped = POLICY.slugMap[top.slug];
  const second = candidates[1];
  const close = Boolean(second && second.score / top.score >= 0.78);
  const confidence: TaxonomyResolution["confidence"] =
    top.score >= 50 && !close ? "high" : top.score >= 28 && !close ? "medium" : "low";

  return {
    taxonomySlug: entry.slug,
    canonicalName: entry.canonicalName,
    matcherSlug: entry.matcherSlug,
    relatedPracticeAreas: entry.relatedPracticeAreas,
    expandedTerms: uniqueLower([
      ...entry.searchBoostTerms,
      ...entry.subIssues,
      ...entry.relatedPracticeAreas,
      entry.canonicalName,
    ]),
    clarificationQuestion: entry.clarificationQuestions[0] ?? null,
    searchBoostTerms: entry.searchBoostTerms,
    legalAidLikely: entry.legalAidLikely,
    matchStrength: Math.min(1, top.score / 48),
    topicId: mapped?.topicId || "general",
    matterType: mapped?.matterType || "unknown",
    candidates: candidates.slice(0, 6),
    questionFocus: question.slice(0, 280),
    confidence,
    reason: `${top.slug} (${top.sources.slice(0, 3).join(", ")})`,
  };
}
