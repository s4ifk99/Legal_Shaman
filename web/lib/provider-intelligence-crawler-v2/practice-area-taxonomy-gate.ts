import { LEGAL_ISSUE_TAXONOMY } from "@/lib/legal/legal-issue-taxonomy-data";
import {
  EXACT_PHRASE_KEYS,
  EXACT_PHRASE_SLUG,
  normalizePhrase,
  singularizePhrase,
  slugLabel,
  type PracticeAreaProvenance,
} from "@/lib/provider-crawler/practice-area-normalizer";

/** All slugs allowed for provider practice-area extraction. */
export const APPROVED_PRACTICE_AREA_SLUGS = new Set<string>([
  ...LEGAL_ISSUE_TAXONOMY.map((e) => e.slug),
  "human_rights",
  "judicial_review",
]);

export const PRACTICE_AREA_TAXONOMY_REJECT_REASON = "not_approved_taxonomy";

/** Marketing / UI copy — never valid practice areas. */
const BLOCKED_PHRASE_PATTERNS: RegExp[] = [
  /\bnewsletter\b/i,
  /\bsign\s*up\b/i,
  /\bsubscribe\b/i,
  /\breach\s*out\b/i,
  /\bget\s+in\s+touch\b/i,
  /\bcontact\s+us\b/i,
  /\bfree\s+confidential\s+call\b/i,
  /\bbook(?:ing)?\s+(?:a\s+)?(?:call|appointment|consultation|now)\b/i,
  /\bbooking\s+details\b/i,
  /\bpersonal\s+info(?:rmation)?\b/i,
  /\benquiry\s+form\b/i,
  /\binquiry\s+form\b/i,
  /\brequest\s+a\s+callback\b/i,
  /\bclick\s+here\b/i,
  /\blearn\s+more\b/i,
  /\bread\s+more\b/i,
  /\bfind\s+out\s+more\b/i,
  /\bour\s+process\b/i,
  /\bstep\s+process\b/i,
  /\bpeace\s+of\s+mind\b/i,
  /\bthree\s+step\b/i,
  /\bwhy\s+choose\s+us\b/i,
  /\babout\s+us\b/i,
  /\bmeet\s+the\s+team\b/i,
  /\bour\s+team\b/i,
  /\bclient\s+testimonials?\b/i,
  /\blatest\s+news\b/i,
  /\bcareers?\b/i,
  /\bvacanc(?:y|ies)\b/i,
  /\bprivacy\s+policy\b/i,
  /\bcookie\s+policy\b/i,
  /\bterms\s+(?:and|&)\s+conditions\b/i,
  /\bhome\b/i,
  /\bwelcome\b/i,
  /\bfaqs?\b/i,
  /\bget\s+a\s+quote\b/i,
];

const GENERIC_HEADING_EXACT = new Set(
  [
    "home",
    "welcome",
    "about us",
    "about",
    "contact",
    "contact us",
    "services",
    "our services",
    "news",
    "blog",
    "careers",
    "team",
    "our team",
    "faq",
    "faqs",
    "newsletter sign up",
    "reach out",
    "free confidential call",
    "booking details",
    "personal info",
    "personal information",
    "enquiry",
    "enquiry form",
    "get in touch",
    "book a call",
    "book now",
  ].map(normalizePhrase),
);

export type PracticeAreaTaxonomyGateResult =
  | {
      allowed: true;
      slug: string;
      displayName: string;
      confidence: number;
      matchType: "exact_phrase" | "taxonomy_alias" | "approved_slug";
    }
  | {
      allowed: false;
      reason: string;
      detail?: string;
    };

export function isBlockedPracticeAreaPhrase(phrase: string): string | null {
  const raw = phrase.trim();
  if (!raw || raw.length < 2) return "empty_phrase";
  if (raw.length > 120) return "phrase_too_long";

  const normalized = normalizePhrase(raw);
  if (GENERIC_HEADING_EXACT.has(normalized)) return "generic_page_heading";

  for (const re of BLOCKED_PHRASE_PATTERNS) {
    if (re.test(raw) || re.test(normalized)) return "blocked_marketing_or_ui_phrase";
  }

  const wordCount = normalized.split(" ").filter(Boolean).length;
  if (wordCount >= 6 && !/\blaw\b|\blegal\b|\bsolicitor\b/i.test(normalized)) {
    return "marketing_sentence_not_practice_area";
  }

  return null;
}

/** Exact taxonomy match only — no fuzzy substring matching. */
export function resolvePhraseStrict(phrase: string): PracticeAreaProvenance {
  const raw = phrase.trim();
  const normalized = normalizePhrase(raw);
  const singular = singularizePhrase(normalized);

  for (const key of EXACT_PHRASE_KEYS) {
    if (normalized === key || singular === key) {
      const slug = EXACT_PHRASE_SLUG[key]!;
      if (!APPROVED_PRACTICE_AREA_SLUGS.has(slug)) {
        return { raw, slug: null, displayName: null, confidence: 0 };
      }
      return { raw, slug, displayName: slugLabel(slug), confidence: 0.97 };
    }
  }

  const candidates = [normalized, singular].filter(Boolean);
  for (const c of candidates) {
    for (const entry of buildStrictPhraseIndex()) {
      if (c === entry.phrase) {
        if (!APPROVED_PRACTICE_AREA_SLUGS.has(entry.slug)) {
          return { raw, slug: null, displayName: null, confidence: 0 };
        }
        return {
          raw,
          slug: entry.slug,
          displayName: entry.canonicalName,
          confidence: Math.min(1, entry.weight),
        };
      }
    }
  }

  return { raw, slug: null, displayName: null, confidence: 0 };
}

type StrictPhraseEntry = { phrase: string; slug: string; canonicalName: string; weight: number };

let strictIndex: StrictPhraseEntry[] | null = null;

function buildStrictPhraseIndex(): StrictPhraseEntry[] {
  if (strictIndex) return strictIndex;
  const entries: StrictPhraseEntry[] = [];
  const add = (phrase: string, slug: string, canonicalName: string, weight: number) => {
    const p = normalizePhrase(phrase);
    if (p.length < 2 || !APPROVED_PRACTICE_AREA_SLUGS.has(slug)) return;
    entries.push({ phrase: p, slug, canonicalName, weight });
  };

  for (const e of LEGAL_ISSUE_TAXONOMY) {
    add(e.slug.replace(/_/g, " "), e.slug, e.canonicalName, 1);
    add(e.canonicalName, e.slug, e.canonicalName, 0.98);
    for (const a of e.aliases) add(a, e.slug, e.canonicalName, 0.95);
    for (const u of e.userPhrases) add(u, e.slug, e.canonicalName, 0.9);
    for (const s of e.subIssues) add(s, e.slug, e.canonicalName, 0.88);
  }

  add("Human Rights", "human_rights", "Human Rights", 0.98);
  add("human rights", "human_rights", "Human Rights", 0.95);
  add("Judicial Review", "judicial_review", "Judicial Review", 0.98);
  add("judicial review", "judicial_review", "Judicial Review", 0.95);
  add("homelessness", "housing", "Housing Law", 0.9);

  strictIndex = entries.sort((a, b) => b.phrase.length - a.phrase.length);
  return strictIndex;
}

export function gatePracticeAreaSlug(slug: string): PracticeAreaTaxonomyGateResult {
  const s = slug.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]*$/.test(s)) {
    return { allowed: false, reason: "invalid_slug_format", detail: slug };
  }
  if (!APPROVED_PRACTICE_AREA_SLUGS.has(s)) {
    return { allowed: false, reason: "slug_not_in_taxonomy", detail: s };
  }
  return {
    allowed: true,
    slug: s,
    displayName: slugLabel(s),
    confidence: 0.95,
    matchType: "approved_slug",
  };
}

export function gatePracticeAreaPhrase(phrase: string): PracticeAreaTaxonomyGateResult {
  const blocked = isBlockedPracticeAreaPhrase(phrase);
  if (blocked) return { allowed: false, reason: blocked, detail: phrase };

  const resolved = resolvePhraseStrict(phrase);
  if (!resolved.slug) {
    return { allowed: false, reason: "no_strict_taxonomy_match", detail: phrase };
  }

  return {
    allowed: true,
    slug: resolved.slug,
    displayName: resolved.displayName ?? slugLabel(resolved.slug),
    confidence: resolved.confidence,
    matchType: "taxonomy_alias",
  };
}

export function gatePracticeAreaLabelOrSlug(
  label: string,
  slug?: string | null,
): PracticeAreaTaxonomyGateResult {
  if (slug?.trim()) {
    const bySlug = gatePracticeAreaSlug(slug);
    if (bySlug.allowed) return bySlug;
  }
  return gatePracticeAreaPhrase(label);
}
