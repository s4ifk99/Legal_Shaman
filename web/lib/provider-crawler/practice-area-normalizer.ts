import { LEGAL_ISSUE_TAXONOMY } from "@/lib/legal/legal-issue-taxonomy-data";

/** GOV.UK / legal-aid variants not covered cleanly by taxonomy slug alone. */
const SUPPLEMENTAL_SLUGS: Record<
  string,
  { canonicalName: string; aliases: string[] }
> = {
  human_rights: {
    canonicalName: "Human Rights",
    aliases: ["human rights", "human rights law", "human right"],
  },
  judicial_review: {
    canonicalName: "Judicial Review",
    aliases: [
      "judicial review",
      "public law and judicial review",
      "public law",
      "jr",
      "administrative law",
    ],
  },
};

const PLURAL_EXCEPTIONS = new Set([
  "rights",
  "news",
  "police",
  "housing",
  "benefits",
  "debt",
]);

export type PracticeAreaProvenance = {
  raw: string;
  slug: string | null;
  displayName: string | null;
  confidence: number;
};

export type NormalizedPracticeAreas = {
  rawExtractedValue: string;
  normalizedValues: string[];
  canonicalSlugs: string[];
  taxonomyConfidence: number;
  provenance: PracticeAreaProvenance[];
};

type PhraseEntry = {
  phrase: string;
  slug: string;
  canonicalName: string;
  weight: number;
};

/** Exact phrase overrides (longest keys checked first). */
const EXACT_PHRASE_SLUG: Record<string, string> = {
  "public law and judicial review": "judicial_review",
  "housing homelessness": "housing",
  "human rights law": "human_rights",
  "human rights": "human_rights",
  "housing law": "housing",
  "judicial review": "judicial_review",
  "community care": "community_care",
  debt: "debt",
};

const EXACT_PHRASE_KEYS = Object.keys(EXACT_PHRASE_SLUG).sort((a, b) => b.length - a.length);

const PHRASE_INDEX: PhraseEntry[] = buildPhraseIndex();

function buildPhraseIndex(): PhraseEntry[] {
  const entries: PhraseEntry[] = [];

  const add = (phrase: string, slug: string, canonicalName: string, weight: number) => {
    const p = normalizePhrase(phrase);
    if (p.length < 2) return;
    entries.push({ phrase: p, slug, canonicalName, weight });
  };

  for (const e of LEGAL_ISSUE_TAXONOMY) {
    add(e.slug.replace(/_/g, " "), e.slug, e.canonicalName, 1);
    add(e.canonicalName, e.slug, e.canonicalName, 0.98);
    add(e.matcherSlug.replace(/_/g, " "), e.slug, e.canonicalName, 0.92);
    for (const a of e.aliases) add(a, e.slug, e.canonicalName, 0.95);
    for (const u of e.userPhrases) add(u, e.slug, e.canonicalName, 0.9);
    for (const s of e.subIssues) add(s, e.slug, e.canonicalName, 0.88);
    for (const r of e.relatedPracticeAreas) add(r, e.slug, e.canonicalName, 0.85);
    for (const t of e.searchBoostTerms) add(t, e.slug, e.canonicalName, 0.82);
  }

  for (const [slug, def] of Object.entries(SUPPLEMENTAL_SLUGS)) {
    add(def.canonicalName, slug, def.canonicalName, 0.98);
    for (const a of def.aliases) add(a, slug, def.canonicalName, 0.95);
  }

  add("homelessness", "housing", "Housing Law", 0.9);

  return entries.sort((a, b) => b.phrase.length - a.phrase.length);
}

export function normalizePhrase(text: string): string {
  return text
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function singularizeWord(word: string): string {
  if (PLURAL_EXCEPTIONS.has(word)) return word;
  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith("s") && !word.endsWith("ss") && word.length > 3) return word.slice(0, -1);
  return word;
}

export function singularizePhrase(phrase: string): string {
  return phrase
    .split(" ")
    .map(singularizeWord)
    .join(" ");
}

function splitRawSegments(raw: string): string[] {
  return raw
    .split(/[,;|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function slugDisplayName(slug: string): string {
  const tax = LEGAL_ISSUE_TAXONOMY.find((e) => e.slug === slug);
  if (tax) return tax.canonicalName;
  return SUPPLEMENTAL_SLUGS[slug]?.canonicalName ?? slug.replace(/_/g, " ");
}

function resolvePhrase(phrase: string): PracticeAreaProvenance {
  const raw = phrase.trim();
  const normalized = normalizePhrase(raw);
  const singular = singularizePhrase(normalized);

  for (const key of EXACT_PHRASE_KEYS) {
    if (normalized === key || singular === key) {
      const slug = EXACT_PHRASE_SLUG[key]!;
      return { raw, slug, displayName: slugDisplayName(slug), confidence: 0.97 };
    }
  }

  const candidates = [normalized, singular].filter(Boolean);
  for (const c of candidates) {
    for (const entry of PHRASE_INDEX) {
      if (c === entry.phrase) {
        return {
          raw,
          slug: entry.slug,
          displayName: entry.canonicalName,
          confidence: Math.min(1, entry.weight),
        };
      }
    }
  }

  for (const c of candidates) {
    let best: PhraseEntry | null = null;
    for (const entry of PHRASE_INDEX) {
      if (entry.phrase.length < 4) continue;
      if (c.includes(entry.phrase) || entry.phrase.includes(c)) {
        if (!best || entry.phrase.length > best.phrase.length) best = entry;
      }
    }
    if (best) {
      const overlap = Math.min(c.length, best.phrase.length) / Math.max(c.length, best.phrase.length);
      return {
        raw,
        slug: best.slug,
        displayName: best.canonicalName,
        confidence: Math.min(0.88, best.weight * overlap),
      };
    }
  }

  return { raw, slug: null, displayName: null, confidence: 0 };
}

/** Map public_law taxonomy matches to judicial_review when phrase explicitly references JR. */
function preferJudicialReviewSlug(provenance: PracticeAreaProvenance): PracticeAreaProvenance {
  if (provenance.slug !== "public_law") return provenance;
  const n = normalizePhrase(provenance.raw);
  if (
    n.includes("judicial review") ||
    n.includes("public law and judicial review") ||
    n === "jr" ||
    n.includes("administrative law")
  ) {
    return {
      ...provenance,
      slug: "judicial_review",
      displayName: SUPPLEMENTAL_SLUGS.judicial_review!.canonicalName,
    };
  }
  return provenance;
}

/**
 * Normalize raw extracted practice-area text into canonical taxonomy slugs.
 * Deterministic: stable slug order, duplicate collapse, provenance per segment.
 */
export function normalizePracticeAreas(raw: string): NormalizedPracticeAreas {
  const rawExtractedValue = raw.trim();
  const segments = splitRawSegments(rawExtractedValue);
  const provenance: PracticeAreaProvenance[] = [];
  const slugToDisplay = new Map<string, string>();

  for (const segment of segments) {
    const resolved = preferJudicialReviewSlug(resolvePhrase(segment));
    provenance.push(resolved);
    if (resolved.slug && resolved.displayName) {
      slugToDisplay.set(resolved.slug, resolved.displayName);
    }
  }

  const canonicalSlugs = [...slugToDisplay.keys()].sort((a, b) => a.localeCompare(b));
  const normalizedValues = canonicalSlugs.map((s) => slugToDisplay.get(s)!);

  const matched = provenance.filter((p) => p.slug !== null);
  const taxonomyConfidence =
    matched.length > 0
      ? Math.round(
          (matched.reduce((sum, p) => sum + p.confidence, 0) / matched.length) * 100,
        ) / 100
      : 0;

  return {
    rawExtractedValue,
    normalizedValues,
    canonicalSlugs,
    taxonomyConfidence,
    provenance,
  };
}

/** Stable dedup key from canonical slug set (used for moderation clustering). */
export function canonicalSlugDedupKey(slugs: string[]): string {
  return [...new Set(slugs)].sort((a, b) => a.localeCompare(b)).join("|");
}

export function formatCanonicalSlugsForDisplay(slugs: string[]): string {
  const names = slugs.map((slug) => {
    const tax = LEGAL_ISSUE_TAXONOMY.find((e) => e.slug === slug);
    if (tax) return tax.canonicalName;
    return SUPPLEMENTAL_SLUGS[slug]?.canonicalName ?? slug.replace(/_/g, " ");
  });
  return names.join(", ");
}

export function slugLabel(slug: string): string {
  const tax = LEGAL_ISSUE_TAXONOMY.find((e) => e.slug === slug);
  if (tax) return tax.canonicalName;
  return SUPPLEMENTAL_SLUGS[slug]?.canonicalName ?? slug.replace(/_/g, " ");
}
