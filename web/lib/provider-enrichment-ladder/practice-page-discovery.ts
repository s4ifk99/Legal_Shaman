import { ladderConfidence } from "@/lib/provider-enrichment-ladder/enrichment-confidence";
import {
  gatePracticeAreaPhrase,
  gatePracticeAreaSlug,
} from "@/lib/provider-intelligence-crawler-v2/practice-area-taxonomy-gate";
import type { ExtractedFieldCandidate } from "@/lib/provider-crawler/types";

const PRACTICE_PATH_SLUGS: { pattern: RegExp; slug: string; weight: number }[] = [
  { pattern: /\/employment[-_]?law/i, slug: "employment", weight: 0.92 },
  { pattern: /\/family[-_]?law/i, slug: "family", weight: 0.92 },
  { pattern: /\/divorce/i, slug: "family", weight: 0.88 },
  { pattern: /\/immigration/i, slug: "immigration", weight: 0.92 },
  { pattern: /\/housing[-_]?(?:law|disrepair)/i, slug: "housing", weight: 0.9 },
  { pattern: /\/personal[-_]?injury/i, slug: "personal_injury", weight: 0.9 },
  { pattern: /\/criminal/i, slug: "criminal_defence", weight: 0.88 },
  { pattern: /\/prison/i, slug: "prison_law", weight: 0.88 },
  { pattern: /\/wills|\/probate|\/estate/i, slug: "wills_probate", weight: 0.85 },
  { pattern: /\/conveyancing/i, slug: "conveyancing", weight: 0.9 },
];

const NAV_PATH_HINTS = [
  "/services",
  "/practice-areas",
  "/practice-areas/",
  "/our-services",
  "/legal-services",
  "/expertise",
  "/specialisms",
  "/areas-of-law",
];

const HEADING_RE = /<h[1-3][^>]*>([^<]{3,120})<\/h[1-3]>/gi;

export function discoverPracticePageUrls(baseUrl: string, html: string): string[] {
  const out: string[] = [];
  let base: URL;
  try {
    base = new URL(baseUrl.startsWith("http") ? baseUrl : `https://${baseUrl}`);
  } catch {
    return out;
  }

  for (const path of NAV_PATH_HINTS) {
    try {
      out.push(new URL(path, base.origin).href);
    } catch {
      /* skip */
    }
  }

  const hrefRe = /href=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html))) {
    const href = m[1];
    if (!/\/(service|practice|expertise|area|law)/i.test(href)) continue;
    try {
      const abs = new URL(href, base.origin).href;
      if (abs.startsWith(base.origin)) out.push(abs);
    } catch {
      /* skip */
    }
  }

  return [...new Set(out)].slice(0, 12);
}

export function slugsFromPageUrl(url: string): { slug: string; confidence: number; signal: string }[] {
  const found: { slug: string; confidence: number; signal: string }[] = [];
  for (const { pattern, slug, weight } of PRACTICE_PATH_SLUGS) {
    if (!pattern.test(url)) continue;
    const gate = gatePracticeAreaSlug(slug);
    if (!gate.allowed) continue;
    found.push({ slug: gate.slug, confidence: weight, signal: "url_slug" });
  }
  return found;
}

export function extractPracticeAreaCandidates(
  text: string,
  html: string,
  pageUrl: string,
  ctx: { entityId: string; entityType: string },
): ExtractedFieldCandidate[] {
  const slugHits = new Map<string, { confidence: number; signal: string; displayName: string }>();

  for (const hit of slugsFromPageUrl(pageUrl)) {
    const prev = slugHits.get(hit.slug);
    if (!prev || hit.confidence > prev.confidence) {
      slugHits.set(hit.slug, {
        confidence: hit.confidence,
        signal: hit.signal,
        displayName: hit.slug.replace(/_/g, " "),
      });
    }
  }

  let hm: RegExpExecArray | null;
  while ((hm = HEADING_RE.exec(html))) {
    const title = hm[1].replace(/\s+/g, " ").trim();
    const gate = gatePracticeAreaPhrase(title);
    if (!gate.allowed) continue;
    const prev = slugHits.get(gate.slug);
    const conf = Math.max(prev?.confidence ?? 0, gate.confidence);
    slugHits.set(gate.slug, {
      confidence: conf,
      signal: prev?.signal ?? "services_page_title_strict",
      displayName: gate.displayName,
    });
  }

  if (!slugHits.size) return [];

  const slugs = [...slugHits.keys()].sort();
  const avgConf =
    [...slugHits.values()].reduce((s, v) => s + v.confidence, 0) / slugHits.size;

  return [
    {
      entityId: ctx.entityId,
      entityType: ctx.entityType,
      fieldName: "practice_areas",
      extractedValue: slugs.join(","),
      confidence: ladderConfidence({
        sourceType: "provider_website",
        extractionConfidence: avgConf,
        signal: "taxonomy_gate",
      }),
      sourceUrl: pageUrl,
      sourceType: "provider_website",
      extractionMethod: "html_parse",
      provenanceNote: JSON.stringify({
        slugs,
        gate: "strict_taxonomy",
        labels: slugs.map((s) => slugHits.get(s)!.displayName),
      }),
      extractedAt: new Date(),
    },
  ];
}
