import { LEGAL_ISSUE_TAXONOMY, type LegalIssueTaxonomyEntry } from "@/lib/legal/legal-issue-taxonomy-data";

export type QueryPhraseExpansion = {
  slug: string;
  userPhrases: string[];
  legalTerms: string[];
  emergencyPhrases: string[];
  capabilityPhrases: string[];
  relatedAreas: string[];
  issueAliases: string[];
};

/** Extra plain-English phrases beyond taxonomy seed data. */
const EXTRA_USER_PHRASES: Record<string, string[]> = {
  employment: [
    "lost my job",
    "got fired",
    "made redundant",
    "boss dismissed me",
    "workplace problem",
    "unfairly fired",
    "sacked from work",
    "employment problem",
  ],
  housing: [
    "landlord kicked me out",
    "eviction notice",
    "rent arrears",
    "bad housing conditions",
    "housing disrepair",
    "kicked out of my flat",
    "landlord wants me out",
    "homeless tonight",
  ],
  family: [
    "going through divorce",
    "splitting up",
    "ex won't let me see kids",
    "child contact problem",
    "matrimonial dispute",
  ],
  immigration: [
    "visa refused",
    "visa application refused",
    "asylum claim",
    "facing deportation",
    "immigration problem",
  ],
  criminal_defence: [
    "arrested by police",
    "charged with a crime",
    "need duty solicitor",
    "court tomorrow",
  ],
  prison_law: [
    "someone in prison",
    "family member in prison",
    "parole hearing",
    "prison recall",
  ],
  welfare_benefits: [
    "benefits stopped",
    "PIP refused",
    "universal credit problem",
    "benefits tribunal",
  ],
};

/** Neighbour / ASB phrases map to housing retrieval. */
const HOUSING_NEIGHBOUR_PHRASES = [
  "problem with neighbour",
  "neighbour harassment",
  "noise complaint",
  "boundary dispute",
  "neighbour dispute",
  "anti social behaviour",
  "antisocial neighbours",
];

const FUNDING_CAPABILITY_PHRASES = [
  "legal aid",
  "legal aid provider",
  "free legal advice",
  "pro bono",
  "no win no fee",
  "fixed fee",
  "legal aid funded",
];

const URGENCY_CAPABILITY_PHRASES = [
  "urgent advice",
  "same day",
  "emergency",
  "out of hours",
  "immediate help",
];

const TRIBUNAL_CAPABILITY_PHRASES = [
  "tribunal representation",
  "employment tribunal",
  "immigration tribunal",
  "benefits tribunal",
  "send tribunal",
  "first tier tribunal",
];

const ACCESSIBILITY_CAPABILITY_PHRASES = [
  "interpreter",
  "remote consultation",
  "video call",
  "disability access",
  "reasonable adjustments",
];

const LANGUAGE_CAPABILITY_PHRASES = [
  "urdu speaking",
  "punjabi speaking",
  "arabic speaking",
  "bengali speaking",
  "polish speaking",
  "interpreter",
];

function uniqueLower(items: string[], max = 48): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of items) {
    const t = s.trim();
    if (t.length < 2) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

function entryToExpansion(entry: LegalIssueTaxonomyEntry): QueryPhraseExpansion {
  const extra = EXTRA_USER_PHRASES[entry.slug] ?? [];
  const neighbour =
    entry.slug === "housing" ? HOUSING_NEIGHBOUR_PHRASES : [];
  return {
    slug: entry.slug,
    userPhrases: uniqueLower([...entry.userPhrases, ...extra, ...neighbour]),
    legalTerms: uniqueLower([
      entry.canonicalName,
      ...entry.aliases,
      ...entry.searchBoostTerms,
      ...entry.subIssues,
    ]),
    emergencyPhrases: uniqueLower(entry.emergencySignals),
    capabilityPhrases: uniqueLower([
      ...(entry.legalAidLikely ? ["legal aid likely", "legal aid"] : []),
      ...TRIBUNAL_CAPABILITY_PHRASES.filter((p) =>
        entry.searchBoostTerms.some((t) => t.toLowerCase().includes("tribunal")),
      ),
    ]),
    relatedAreas: uniqueLower(entry.relatedPracticeAreas),
    issueAliases: uniqueLower([
      entry.canonicalName,
      ...entry.aliases,
      entry.matcherSlug.replace(/_/g, " "),
    ]),
  };
}

const bySlug = new Map(LEGAL_ISSUE_TAXONOMY.map((e) => [e.slug, entryToExpansion(e)]));

export function getQueryPhraseExpansion(slug: string): QueryPhraseExpansion | null {
  return bySlug.get(slug) ?? null;
}

export function mergePhraseExpansions(slugs: string[]): QueryPhraseExpansion {
  const merged: QueryPhraseExpansion = {
    slug: slugs[0] ?? "general",
    userPhrases: [],
    legalTerms: [],
    emergencyPhrases: [],
    capabilityPhrases: [],
    relatedAreas: [],
    issueAliases: [],
  };
  for (const slug of slugs) {
    const exp = getQueryPhraseExpansion(slug);
    if (!exp) continue;
    merged.userPhrases.push(...exp.userPhrases);
    merged.legalTerms.push(...exp.legalTerms);
    merged.emergencyPhrases.push(...exp.emergencyPhrases);
    merged.capabilityPhrases.push(...exp.capabilityPhrases);
    merged.relatedAreas.push(...exp.relatedAreas);
    merged.issueAliases.push(...exp.issueAliases);
  }
  merged.userPhrases = uniqueLower(merged.userPhrases);
  merged.legalTerms = uniqueLower(merged.legalTerms);
  merged.emergencyPhrases = uniqueLower(merged.emergencyPhrases);
  merged.capabilityPhrases = uniqueLower(merged.capabilityPhrases);
  merged.relatedAreas = uniqueLower(merged.relatedAreas);
  merged.issueAliases = uniqueLower(merged.issueAliases);
  return merged;
}

export const GLOBAL_FUNDING_TERMS = uniqueLower(FUNDING_CAPABILITY_PHRASES);
export const GLOBAL_URGENCY_TERMS = uniqueLower(URGENCY_CAPABILITY_PHRASES);
export const GLOBAL_TRIBUNAL_TERMS = uniqueLower(TRIBUNAL_CAPABILITY_PHRASES);
export const GLOBAL_ACCESSIBILITY_TERMS = uniqueLower(ACCESSIBILITY_CAPABILITY_PHRASES);
export const GLOBAL_LANGUAGE_TERMS = uniqueLower(LANGUAGE_CAPABILITY_PHRASES);
