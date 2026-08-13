/**
 * Dworkin-ranked Coherence snippets for Overview, filtered by Taxonomy slug.
 * Mixed with wiki hits — never used to classify the issue.
 */
import policy from "@/lib/legal/taxonomy-policy.json";
import craSpine from "@/data/coherence/primaryLaw/craGoodsRemedies.json";
import wikiGuidesRaw from "@/data/coherence/catalogues/wiki-guides.json";
import consumerWiki from "@/data/coherence/wikis/consumerWiki.json";
import housingWiki from "@/data/coherence/wikis/housingWiki.json";
import employmentWiki from "@/data/coherence/wikis/employmentWiki.json";
import debtWiki from "@/data/coherence/wikis/debtWiki.json";
import familyWiki from "@/data/coherence/wikis/familyWiki.json";
import immigrationWiki from "@/data/coherence/wikis/immigrationWiki.json";
import crimeWiki from "@/data/coherence/wikis/crimeWiki.json";
import { resolveTaxonomy } from "@/lib/legal/taxonomy-resolver";
import {
  DWORKIN_BOOST,
  inferDworkinKind,
  normalizeDworkinKey,
  type DworkinKind,
} from "@/lib/wiki/dworkin-tags";

export type OverviewDworkinSnippet = {
  id: string;
  title: string;
  snippet: string;
  url: string;
  dworkinKind: DworkinKind;
  dworkinSource: "mapped" | "inferred";
  layer: "dworkin-guides" | "dworkin-wiki" | "primary-law";
  authority: "primary" | "secondary" | "tertiary";
  score: number;
};

type Policy = {
  slugMap: Record<string, { matterType: string; topicId: string }>;
};

const POLICY = policy as Policy;

const DOMAIN_WIKIS: Record<string, { domainId?: string; pages?: DomainPage[] }> = {
  consumer: consumerWiki,
  housing: housingWiki,
  employment: employmentWiki,
  debt: debtWiki,
  family: familyWiki,
  immigration: immigrationWiki,
  crime: crimeWiki,
};

type DomainPage = {
  id?: string;
  title?: string;
  snippet?: string;
  primaryUrl?: string;
  path?: string;
  keywords?: string[];
  authority?: string;
  domainId?: string;
  frameIds?: string[];
};

type GuideArticle = {
  id?: string;
  title?: string;
  path?: string;
  bodyPreview?: string;
  description?: string;
  sourceUrl?: string;
  dworkinKind?: string | null;
  keywords?: string[];
  topic?: string;
  authority?: string;
};

const SLUG_REJECT: Record<string, RegExp> = {
  parking_pcn:
    /employment law|working (time|hours)|grievance|unfair dismiss|holiday pay|water supply|housing association|section 21|flatmate|car repair|vehicle insurance|highway code|intended prosecution|motoring offences|bailiff|parking in front of your house|private property and driveways/i,
  consumer_vehicle_repair:
    /employment law|working (time|hours)|grievance|water supply|parking ticket|penalty charge|\bpcn\b|section 21|vehicle insurance|highway code|intended prosecution|motoring offences|energy ombudsman/i,
  housing:
    /parking ticket|penalty charge|\bpcn\b|unfair dismiss|working time|car repair|vehicle insurance|highway code/i,
  employment:
    /parking ticket|penalty charge|\bpcn\b|car repair|water supply|blue badge|vehicle insurance|highway code/i,
  neighbour_dispute:
    /parking ticket|unfair dismiss|car repair|working time|vehicle insurance/i,
  consumer:
    /unfair dismiss|section 21|working time/i,
  consumer_services:
    /unfair dismiss|section 21|parking ticket/i,
  conveyancing:
    /used car|car repair|travel agent|business agent|consumer contracts.*online|cancel.*online|employment law|parking ticket/i,
};

const SLUG_NEED: Record<string, RegExp> = {
  parking_pcn:
    /\bpcns?\b|penalty charge|contravention|civil enforcement|london tribunal|appealing a parking|parking tickets|when to appeal a parking|stop being chased for a parking/i,
  consumer_vehicle_repair:
    /car repair|repairing a car|garage|workmanship|faulty goods|ombudsman|poor service|used part|consumer rights act|\bcra\b/i,
  housing:
    /hous|tenant|landlord|rent|flatmate|lodger|tenancy|deposit|evict|accommodat|disrepair|mould|joint/i,
  employment:
    /employ|dismiss|acas|wage|grievance|redundan|workplace|holiday pay|sacked|rights at work/i,
  neighbour_dispute:
    /neighbour|neighbor|boundary|party wall|extension|planning|right of way|driveway|access/i,
  conveyancing:
    /conveyanc|property purchase|buying a (home|house|flat)|estate agent|misrepresent|demolition|cladding|service charge|surveyor|house sale|leasehold/i,
};

const STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "have",
  "will",
  "your",
  "what",
  "when",
  "about",
  "into",
  "notice",
  "claim",
  "court",
  "legal",
  "advice",
]);

function clip(text: string, max = 360): string {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trim()}…`;
}

function queryTokens(text: string, limit = 40): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9£\s-]/g, " ")
    .split(/\s+/)) {
    if (raw.length < 3 || STOP.has(raw) || seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
    if (out.length >= limit) break;
  }
  return out;
}

function scoreText(haystack: string, tokens: string[]): number {
  if (!haystack || !tokens.length) return 0;
  const h = haystack.toLowerCase();
  let score = 0;
  for (const t of tokens) {
    if (h.includes(t)) score += t.length >= 6 ? 3 : 2;
  }
  return score;
}

function asKind(value: unknown): DworkinKind | null {
  const k = String(value || "").toLowerCase();
  return k === "rule" || k === "principle" || k === "policy" ? k : null;
}

function asAuthority(value: unknown): OverviewDworkinSnippet["authority"] {
  const a = String(value || "").toLowerCase();
  if (a === "primary" || a === "tertiary") return a;
  return "secondary";
}

export function matterTypeForTaxonomySlug(slug: string | null | undefined): string {
  if (!slug) return "unknown";
  return POLICY.slugMap[slug]?.matterType || "unknown";
}

export function snippetFitsTaxonomy(
  blob: string,
  taxonomySlug: string | null | undefined,
  layer: OverviewDworkinSnippet["layer"],
  titlePath = "",
): boolean {
  if (!taxonomySlug) return true;
  if (SLUG_REJECT[taxonomySlug]?.test(blob)) return false;
  const need = SLUG_NEED[taxonomySlug];
  if (need && layer !== "primary-law" && !need.test(titlePath || blob)) return false;
  return true;
}

type Rankable = {
  id: string;
  title: string;
  snippet: string;
  url: string;
  path: string;
  keywords: string[];
  dworkinKind: DworkinKind;
  dworkinSource: "mapped" | "inferred";
  authority: OverviewDworkinSnippet["authority"];
  layer: OverviewDworkinSnippet["layer"];
  topic: string;
};

let cachedGuides: Rankable[] | null = null;

function guidePool(): Rankable[] {
  if (cachedGuides) return cachedGuides;
  const articles = (wikiGuidesRaw as { articles?: GuideArticle[] }).articles || [];
  cachedGuides = articles.map((a) => {
    const mapped = asKind(a.dworkinKind);
    return {
      id: a.id || a.title || "",
      title: a.title || "Untitled guide",
      snippet: clip(a.bodyPreview || a.description || a.title || ""),
      url: a.sourceUrl || "",
      path: a.path || "",
      keywords: Array.isArray(a.keywords) ? a.keywords : [],
      dworkinKind: mapped || inferDworkinKind(a.title || "", a.topic || "", a.path || ""),
      dworkinSource: mapped ? "mapped" : "inferred",
      authority: asAuthority(a.authority),
      layer: "dworkin-guides" as const,
      topic: a.topic || "",
    };
  });
  return cachedGuides;
}

function domainPool(matterType: string): Array<{
  id: string;
  title: string;
  snippet: string;
  url: string;
  path: string;
  keywords: string[];
  dworkinKind: DworkinKind;
  dworkinSource: "inferred";
  authority: OverviewDworkinSnippet["authority"];
  layer: "dworkin-wiki";
  topic: string;
}> {
  const wiki = DOMAIN_WIKIS[matterType];
  if (!wiki?.pages?.length) return [];
  return wiki.pages.map((p) => ({
    id: p.id || p.title || "",
    title: String(p.title || p.id || "Untitled"),
    snippet: clip(p.snippet || p.title || ""),
    url: p.primaryUrl || "",
    path: p.path || "",
    keywords: Array.isArray(p.keywords) ? p.keywords : [],
    dworkinKind: inferDworkinKind(String(p.title || ""), matterType, p.path || ""),
    dworkinSource: "inferred" as const,
    authority: asAuthority(p.authority),
    layer: "dworkin-wiki" as const,
    topic: matterType,
  }));
}

function craPool(): Array<{
  id: string;
  title: string;
  snippet: string;
  url: string;
  path: string;
  keywords: string[];
  dworkinKind: DworkinKind;
  dworkinSource: "mapped";
  authority: OverviewDworkinSnippet["authority"];
  layer: "primary-law";
  topic: string;
}> {
  return (craSpine.sections || []).map((s) => ({
    id: `cra-${s.id}`,
    title: s.label,
    snippet: clip(s.summary || s.label),
    url: s.url || "",
    path: s.raw || "",
    keywords: queryTokens(`${s.label} ${s.summary}`),
    dworkinKind: "rule" as const,
    dworkinSource: "mapped" as const,
    authority: "primary" as const,
    layer: "primary-law" as const,
    topic: "consumer",
  }));
}

/**
 * Rank Coherence snippets for the live Taxonomy slug.
 * Drops titles already present in the wiki hit list.
 */
export function retrieveDworkinSnippetsForOverview(opts: {
  query: string;
  taxonomySlug?: string | null;
  excludeTitles?: string[];
  limit?: number;
}): OverviewDworkinSnippet[] {
  const query = opts.query.trim();
  const tokens = queryTokens(query, 48);
  if (!tokens.length) return [];

  const taxonomySlug =
    opts.taxonomySlug || resolveTaxonomy({ story: query })?.taxonomySlug || null;
  const matterType = matterTypeForTaxonomySlug(taxonomySlug);
  const exclude = new Set(
    (opts.excludeTitles || []).map((t) => normalizeDworkinKey(t)).filter(Boolean),
  );
  const limit = opts.limit ?? 4;

  const wantCra =
    taxonomySlug === "consumer_vehicle_repair" ||
    taxonomySlug === "consumer" ||
    taxonomySlug === "consumer_services";

  const pool = [
    ...guidePool(),
    ...domainPool(matterType === "unknown" ? "" : matterType),
    ...(wantCra ? craPool() : []),
  ];

  const scored: OverviewDworkinSnippet[] = [];
  for (const item of pool) {
    if (exclude.has(normalizeDworkinKey(item.title))) continue;
    const hay = [item.title, item.snippet, item.path, item.topic, ...(item.keywords || [])].join(
      " ",
    );
    if (!snippetFitsTaxonomy(hay, taxonomySlug, item.layer, item.title)) continue;
    if (/blue badge/i.test(item.title) && !/blue badge/i.test(query)) continue;
    let score = scoreText(hay, tokens);
    if (score <= 0) continue;
    score += DWORKIN_BOOST[item.dworkinKind] || 0;
    if (item.layer === "dworkin-wiki") score += 8;
    if (item.layer === "dworkin-guides") score += 5;
    if (item.layer === "primary-law") score += 10;
    if (item.authority === "primary") score += 14;
    else if (item.authority === "secondary") score += 8;
    if (score < 10) continue;
    scored.push({
      id: item.id,
      title: item.title,
      snippet: item.snippet,
      url: item.url,
      dworkinKind: item.dworkinKind,
      dworkinSource: item.dworkinSource,
      layer: item.layer,
      authority: item.authority,
      score,
    });
  }

  scored.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  const out: OverviewDworkinSnippet[] = [];
  const seen = new Set<string>();
  for (const hit of scored) {
    const key = normalizeDworkinKey(hit.title).slice(0, 64);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
    if (out.length >= limit) break;
  }
  return out;
}
