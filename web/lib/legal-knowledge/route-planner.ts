import "server-only";

import { LEGAL_ISSUE_TAXONOMY } from "@/lib/legal/legal-issue-taxonomy-data";

import type { ClassificationFusion } from "./classify-fusion";
import type { LegalSearchIntent } from "./search-intent";
import { isEqualityServicesQuery, isUnsafeProductQuery } from "./search-intent";
import type { SearchRoute } from "./route-types";

function isVercel(): boolean {
  return process.env.VERCEL === "1";
}

export function routeCap(): number {
  return isVercel() ? 3 : 4;
}

function routeCapInternal(): number {
  return routeCap();
}

function normalizeQueryKey(q: string): string {
  return q.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 160);
}

function pushRoute(
  routes: SearchRoute[],
  seen: Set<string>,
  route: SearchRoute,
): void {
  const key = `${route.id}:${normalizeQueryKey(route.query)}`;
  if (seen.has(key)) return;
  if (normalizeQueryKey(route.query).length < 2) return;
  seen.add(key);
  routes.push(route);
}

function patternRoutes(query: string): SearchRoute[] {
  const out: SearchRoute[] = [];
  const q = query;

  if (isUnsafeProductQuery(q)) {
    out.push({
      id: "pattern:unsafe_product",
      label: "Unsafe product / Trading Standards",
      query: "reporting to trading standards unsafe product consumer service",
      taxonomySlug: "consumer",
      signals: ["pattern:unsafe_product"],
    });
    out.push({
      id: "pattern:faulty_purchase",
      label: "Faulty goods / purchase rights",
      query: "something's gone wrong with a purchase faulty goods",
      taxonomySlug: "consumer",
      signals: ["pattern:faulty_purchase"],
    });
  }

  if (/\b(cancel|cancelled|cancellation|tradesman|trader|owe (him|her|them))\b/i.test(q)) {
    out.push({
      id: "pattern:cancel_service",
      label: "Cancel service / trader",
      query: "cancelling a service trader cancellation rights",
      taxonomySlug: "consumer_services",
      signals: ["pattern:cancel_service"],
    });
  }

  if (/\b(neighbour|extension|building regs?)\b/i.test(q)) {
    out.push({
      id: "pattern:party_wall",
      label: "Party wall / neighbour extension",
      query: "party wall extension building regulations neighbour dispute",
      taxonomySlug: "neighbour_dispute",
      signals: ["pattern:party_wall"],
    });
  }

  if (/\b(film|filming|record)\b/i.test(q)) {
    out.push({
      id: "pattern:filming",
      label: "Filming / privacy consent",
      query: "record someone without consent filming privacy",
      signals: ["pattern:filming"],
    });
  }

  if (/\b(customs|import|bringing .{0,40} into (the )?uk)\b/i.test(q)) {
    out.push({
      id: "pattern:customs",
      label: "Customs / import",
      query: "customs import prohibited restricted items UK",
      taxonomySlug: "consumer",
      signals: ["pattern:customs"],
    });
  }

  if (/\b(unfair dismissal|redundan|grievance|acas|employment tribunal)\b/i.test(q)) {
    out.push({
      id: "pattern:employment",
      label: "Employment rights",
      query: "unfair dismissal employment ACAS tribunal workplace rights",
      taxonomySlug: "employment",
      signals: ["pattern:employment"],
    });
  }

  if (isEqualityServicesQuery(q)) {
    out.push({
      id: "pattern:equality_services",
      label: "Equality Act / goods & services",
      query: "taking action about discrimination in goods and services equality act",
      taxonomySlug: "discrimination_equality",
      signals: ["pattern:equality_services"],
    });
    out.push({
      id: "pattern:equality_act_overview",
      label: "Protected characteristics / Equality Act",
      query: "protected characteristics discrimination equality act sex",
      taxonomySlug: "discrimination_equality",
      signals: ["pattern:equality_act_overview"],
    });
  }

  return out;
}

function taxonomyRoute(slug: string, idPrefix: string, signal: string): SearchRoute | null {
  const entry = LEGAL_ISSUE_TAXONOMY.find((e) => e.slug === slug);
  if (!entry) return null;
  return {
    id: `${idPrefix}:${slug}`,
    label: entry.canonicalName,
    query: `${entry.canonicalName} ${entry.userPhrases.slice(0, 4).join(" ")}`.slice(0, 160),
    taxonomySlug: slug,
    signals: [signal],
  };
}

/**
 * Build alternate search routes (satnav-style) from intent + pattern hints.
 * Deterministic — no LLM. Cap: 3 on Vercel, 4 locally.
 */
export function planSearchRoutes(args: {
  query: string;
  intent: LegalSearchIntent;
  fusion?: ClassificationFusion;
}): SearchRoute[] {
  const { query, intent, fusion } = args;
  const routes: SearchRoute[] = [];
  const seen = new Set<string>();
  const cap = routeCapInternal();

  const primaryQ =
    intent.semanticQuery.trim() ||
    intent.retrievalQueries[0]?.trim() ||
    query.replace(/\s+/g, " ").trim().slice(0, 160);

  // Prefer compact semantic intent over raw narrative blob for primary route.
  const longNarrative = query.replace(/\s+/g, " ").trim().length > 220;
  const primaryQuery = longNarrative
    ? (intent.semanticQuery.trim() || intent.retrievalQueries[0]?.trim() || primaryQ).slice(0, 160)
    : primaryQ.slice(0, 160);

  pushRoute(routes, seen, {
    id: "primary",
    label: intent.canonicalName
      ? `Primary: ${intent.canonicalName}`
      : "Primary intent",
    query: primaryQuery,
    taxonomySlug: intent.taxonomySlug,
    signals: ["route:primary", ...intent.signals.slice(0, 4)],
  });

  // Pattern routes first (high-signal) so they survive the route cap.
  for (const pr of patternRoutes(query)) {
    pushRoute(routes, seen, pr);
  }

  for (let i = 0; i < intent.retrievalQueries.length; i++) {
    const q = intent.retrievalQueries[i]?.trim();
    if (!q) continue;
    // Skip duplicate of primary when we already used semantic/primary from retrievalQueries[0]
    if (normalizeQueryKey(q) === normalizeQueryKey(primaryQuery)) continue;
    pushRoute(routes, seen, {
      id: `intent_q${i + 1}`,
      label: `Alternate phrasing ${i + 1}`,
      query: q.slice(0, 160),
      taxonomySlug: intent.taxonomySlug,
      signals: [`route:retrievalQueries[${i}]`],
    });
  }

  if (fusion?.ruleTaxonomySlug && fusion.ruleTaxonomySlug !== intent.taxonomySlug) {
    const r = taxonomyRoute(fusion.ruleTaxonomySlug, "fusion_rule", "fusion:rule");
    if (r) pushRoute(routes, seen, r);
  }
  if (
    fusion?.llmTaxonomySlug &&
    fusion.llmTaxonomySlug !== intent.taxonomySlug &&
    fusion.llmTaxonomySlug !== fusion.ruleTaxonomySlug
  ) {
    const r = taxonomyRoute(fusion.llmTaxonomySlug, "fusion_llm", "fusion:llm");
    if (r) pushRoute(routes, seen, r);
  }

  return routes.slice(0, cap);
}
