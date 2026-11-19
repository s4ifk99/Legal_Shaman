import { authorityTierForUrl } from "@/lib/coherence/authorityAllowlist";
import type { ExaSearchHit } from "@/lib/penumbra/exaSearch";
import type { AdmitCandidate, AdmitJudgment, AdmittedEvidence, SignpostFacet } from "./types";

const GENERIC_TOKENS = new Set([
  "public",
  "law",
  "legal",
  "uk",
  "england",
  "wales",
  "people",
  "person",
  "right",
  "rights",
  "act",
  "section",
  "guide",
  "guidance",
  "information",
  "support",
  "about",
  "what",
  "when",
  "where",
  "how",
  "need",
  "aware",
  "plan",
  "allowed",
]);

const PLACE_FACET_RE = /\b(place|post(er|ing)?|wall|shopfront|highway|fly[\s-]?post|display|affix)\b/i;
const MARCH_HIT_RE =
  /\b(protest\s+march|marches?|demonstration|procession|public\s+assembly|parade)\b/i;

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2 && !GENERIC_TOKENS.has(t)),
  );
}

/**
 * Hard reject: a page about protest marches is not proof for a place/posting facet
 * even when it shares the word "public".
 */
export function isSharedWordCollisionOnly(
  facet: Pick<SignpostFacet, "id" | "need" | "query">,
  hit: { title: string; excerpt: string },
): boolean {
  const facetBlob = `${facet.id} ${facet.need} ${facet.query}`;
  const hitBlob = `${hit.title}\n${hit.excerpt}`;
  if (PLACE_FACET_RE.test(facetBlob) && MARCH_HIT_RE.test(hitBlob)) {
    return true;
  }
  const facetTokens = tokenize(facetBlob);
  const hitTokens = tokenize(hitBlob);
  if (facetTokens.size === 0) return false;
  let overlap = 0;
  for (const t of facetTokens) {
    if (hitTokens.has(t)) overlap += 1;
  }
  return overlap === 0 && /\bpublic\b/i.test(hitBlob) && /\bpublic\b/i.test(facetBlob);
}

/** Keep only primary/secondary authority for open-scope Exa (local councils are .gov.uk → secondary). */
export function filterOpenExaByAuthority(hits: ExaSearchHit[]): ExaSearchHit[] {
  return hits.filter((hit) => {
    const tier = authorityTierForUrl(hit.url);
    return tier === "primary" || tier === "secondary";
  });
}

export function dropBlockedOrUnknownExa(hits: ExaSearchHit[]): ExaSearchHit[] {
  return hits.filter((hit) => {
    const tier = authorityTierForUrl(hit.url);
    return tier !== "blocked" && tier !== "unknown";
  });
}

function normId(value: string): string {
  return value.trim().toLowerCase().replace(/\/$/, "");
}

/** When the LLM admits nothing, keep one strong official hit per facet so research still works. */
export function heuristicAdmitJudgments(
  facets: SignpostFacet[],
  candidates: AdmitCandidate[],
): AdmitJudgment[] {
  const score = (c: AdmitCandidate): number => {
    try {
      const host = new URL(c.url).hostname.toLowerCase();
      if (host === "legislation.gov.uk" || host.endsWith(".legislation.gov.uk")) return 100;
      if (host === "gov.uk" || host.endsWith(".gov.uk")) return 80;
      if (c.kind === "wiki") return 50;
      return 10;
    } catch {
      return c.kind === "wiki" ? 40 : 5;
    }
  };

  const out: AdmitJudgment[] = [];
  for (const facet of facets) {
    const rows = candidates
      .filter((c) => c.facetId === facet.id)
      .filter((c) => !isSharedWordCollisionOnly(facet, c))
      .sort((a, b) => score(b) - score(a));
    const pick = rows.find((c) => score(c) >= 50) || rows[0];
    if (!pick) continue;
    out.push({
      facetId: facet.id,
      urlOrId: pick.urlOrId,
      relevant: true,
      because: "official source fallback",
    });
  }
  return out;
}

export function applyAdmitJudgments(
  candidates: AdmitCandidate[],
  judgments: AdmitJudgment[],
): AdmittedEvidence[] {
  const byKey = new Map(
    judgments.map((j) => [`${normId(j.facetId)}::${normId(j.urlOrId)}`, j]),
  );
  const admitted: AdmittedEvidence[] = [];
  const usedUrls = new Set<string>();

  for (const c of candidates) {
    const keys = [
      `${normId(c.facetId)}::${normId(c.urlOrId)}`,
      `${normId(c.facetId)}::${normId(c.url)}`,
    ];
    let j = keys.map((k) => byKey.get(k)).find(Boolean);
    if (!j) {
      // LLM sometimes returns a shortened id; match on facet + URL substring.
      j = judgments.find(
        (row) =>
          normId(row.facetId) === normId(c.facetId) &&
          row.relevant &&
          (normId(c.url).includes(normId(row.urlOrId)) ||
            normId(row.urlOrId).includes(normId(c.urlOrId)) ||
            normId(row.urlOrId).includes(normId(c.url))),
      );
    }
    if (!j?.relevant) continue;
    if (usedUrls.has(c.url)) continue;
    usedUrls.add(c.url);
    admitted.push({
      facetId: c.facetId,
      title: c.title,
      url: c.url,
      date: c.date,
      excerpt: c.excerpt.slice(0, 1200),
      kind: c.kind,
      wikiId: c.kind === "wiki" ? c.urlOrId : undefined,
    });
  }
  return admitted;
}

export function candidatesForFacet(
  facetId: string,
  admitted: AdmittedEvidence[],
): AdmittedEvidence[] {
  return admitted.filter((a) => a.facetId === facetId);
}

export function isOfficialVolatileHost(url: string, localBody?: string | null): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === "legislation.gov.uk" || host.endsWith(".legislation.gov.uk")) return true;
    if (host === "gov.uk" || host.endsWith(".gov.uk")) return true;
    if (localBody) {
      const slug = localBody
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "")
        .slice(0, 40);
      if (slug && host.replace(/[^a-z0-9]/g, "").includes(slug.slice(0, 12))) return true;
    }
    return false;
  } catch {
    return false;
  }
}
