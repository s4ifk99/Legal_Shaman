import "server-only";

import type { DisputeKind } from "@/lib/cases/dispute-context";
import type { ActionPlanSolicitor, ActionPlanSolicitorCosts } from "@/lib/cases/types";
import {
  resolveSraSearchFlags,
  hasPracticeRoute,
  postcodePrefixesForLocation,
} from "@/lib/coherence/sraQuery";
import {
  searchSraOrganisationsTypesense,
  type CoherenceSraHit,
} from "@/lib/coherence/server/sra-typesense-search";
import {
  serviceLabelForKind,
  sraRequiresPublishedPrices,
} from "@/lib/cases/solicitor-costs";

export type SolicitorMatchMode = "local" | "online" | "reviews" | "unsure";

function matterTypeForKind(kind: DisputeKind | null | undefined): string {
  switch (kind) {
    case "divorce":
      return "family";
    case "housing":
      return "housing";
    case "employment":
      return "employment";
    case "consumer":
      return "consumer";
    case "debt":
      return "debt";
    case "neighbour":
      return "litigation";
    case "benefits":
      return "public";
    default:
      return "unknown";
  }
}

function publishedCostsForHit(
  hit: CoherenceSraHit,
  kind: DisputeKind | null,
): ActionPlanSolicitorCosts | null {
  const serviceLabel = serviceLabelForKind(kind);
  const sraRequired = sraRequiresPublishedPrices(kind);
  const funding = hit.fundingCapabilities || [];
  const hasFixedFee = funding.some((f) => /fixed_fee|fixed fee/i.test(f));
  // We only surface a concrete costs card when the index has a fee signal.
  // Otherwise the UI offers “Ask for costs” (mailto + brief PDF).
  if (!hasFixedFee && !sraRequired) return null;
  if (hasFixedFee) {
    return {
      serviceLabel,
      summary: `This firm signals fixed-fee options in our index for work that may cover ${serviceLabel}. Confirm the exact package and inclusions with the firm before you instruct.`,
      sourceUrl: hit.website || hit.profileUrl || undefined,
      sraRequired,
    };
  }
  return {
    serviceLabel,
    summary: `SRA price-transparency rules usually require firms to publish prices for ${serviceLabel}. We do not yet have their published figures on Legal Shaman — ask them for costs, or check their website fees page.`,
    sourceUrl: hit.website || undefined,
    sraRequired: true,
  };
}

function sraRegisterUrl(sraId?: string, name?: string): string {
  if (sraId) {
    return `https://www.sra.org.uk/consumers/register/search/?searchText=${encodeURIComponent(sraId)}`;
  }
  if (name) {
    return `https://www.sra.org.uk/consumers/register/search/?searchText=${encodeURIComponent(name)}`;
  }
  return "https://www.sra.org.uk/consumers/register/";
}

function locationMatches(
  hit: { city: string; postcode: string },
  locationHint: string,
): boolean {
  const hint = locationHint.trim().toLowerCase();
  if (!hint) return true;
  const city = (hit.city || "").toLowerCase();
  const postcode = (hit.postcode || "").toUpperCase();
  if (city && hint.includes(city)) return true;
  if (city && city.includes(hint.replace(/[^a-z\s]/g, " ").trim())) return true;
  const prefixes = postcodePrefixesForLocation(locationHint);
  if (prefixes.length && postcode) {
    return prefixes.some((p) => postcode.startsWith(p.toUpperCase()));
  }
  const area = hint.toUpperCase().match(/\b([A-Z]{1,2}\d{1,2}[A-Z]?)\b/)?.[1];
  if (area && postcode.startsWith(area)) return true;
  return false;
}

function matchReasonFor(
  mode: SolicitorMatchMode,
  hit: { city: string; postcode: string; website: string },
  locationHint: string,
): string {
  const place = [hit.city, hit.postcode].filter(Boolean).join(" · ");
  if (mode === "local" && locationHint) {
    return place ? `Local match near ${locationHint} (${place})` : `Local search for ${locationHint}`;
  }
  if (mode === "online") {
    return hit.website
      ? "Online-friendly — firm has a public website"
      : "National SRA match — check how they take instructions";
  }
  if (mode === "reviews") {
    return place
      ? `SRA firm — check public reviews (${place})`
      : "SRA firm — check public reviews before you instruct";
  }
  return place || "SRA-regulated firm";
}

export async function matchSolicitorsForCase(input: {
  kind: DisputeKind | null;
  story: string;
  mode: SolicitorMatchMode;
  locationHint?: string | null;
  limit?: number;
  legalAidOnly?: boolean;
}): Promise<{
  solicitors: ActionPlanSolicitor[];
  source: "sra_typesense" | "none";
  emptyReason?: string;
}> {
  const story = input.story.trim();
  const mode = input.mode || "unsure";
  const locationHint = (input.locationHint || "").trim();
  const limit = Math.min(Math.max(input.limit || 5, 1), 8);
  const legalAidOnly = Boolean(input.legalAidOnly);

  if (mode === "local" && !locationHint) {
    return {
      solicitors: [],
      source: "none",
      emptyReason: "need_location",
    };
  }

  const matterType = matterTypeForKind(input.kind);
  const flags = resolveSraSearchFlags({
    matterType,
    query: story.slice(0, 500),
    wantFamily: input.kind === "divorce" ? true : undefined,
    wantHousing: input.kind === "housing" ? true : undefined,
    wantEmployment: input.kind === "employment" ? true : undefined,
    wantConsumer: input.kind === "consumer" ? true : undefined,
    wantDebt: input.kind === "debt" ? true : undefined,
    wantLitigation: input.kind === "neighbour" || input.kind === "general" ? true : undefined,
  });

  if (!hasPracticeRoute(flags) && !locationHint && !legalAidOnly) {
    return { solicitors: [], source: "none", emptyReason: "no_practice_route" };
  }

  const minScore = legalAidOnly
    ? 6
    : mode === "reviews" || mode === "online"
      ? 10
      : locationHint
        ? 12
        : 14;

  const pool = await searchSraOrganisationsTypesense({
    flags: { ...flags, query: story.slice(0, 500), matterType },
    limit: Math.min(40, limit * 8),
    minScore,
    legalAidOnly,
  });

  let ranked = [...pool];

  if (mode === "local" && locationHint) {
    const local = ranked.filter((h) => locationMatches(h, locationHint));
    ranked = local.length ? local : ranked;
  }

  if (legalAidOnly) {
    ranked.sort(
      (a, b) =>
        Number(Boolean(b.legalAid)) - Number(Boolean(a.legalAid)) ||
        b.score - a.score ||
        a.name.localeCompare(b.name),
    );
  } else if (mode === "online") {
    ranked.sort(
      (a, b) =>
        Number(Boolean(b.website)) - Number(Boolean(a.website)) ||
        b.score - a.score ||
        a.name.localeCompare(b.name),
    );
  } else if (mode === "reviews") {
    ranked.sort(
      (a, b) =>
        Number(Boolean(b.rating)) - Number(Boolean(a.rating)) ||
        (b.reviewCount || 0) - (a.reviewCount || 0) ||
        Number(Boolean(b.website)) - Number(Boolean(a.website)) ||
        b.score - a.score ||
        a.name.localeCompare(b.name),
    );
  } else {
    ranked.sort(
      (a, b) =>
        b.score - a.score ||
        Number(Boolean(b.phone)) - Number(Boolean(a.phone)) ||
        a.name.localeCompare(b.name),
    );
  }

  const solicitors: ActionPlanSolicitor[] = ranked.slice(0, limit).map((h) => {
    const costs = publishedCostsForHit(h, input.kind);
    const reviews =
      h.rating || h.reviewCount
        ? {
            rating: h.rating,
            reviewCount: h.reviewCount,
            summary: h.rating
              ? `Rated ${h.rating.toFixed(1)}${h.reviewCount ? ` from ${h.reviewCount} review${h.reviewCount === 1 ? "" : "s"}` : ""} on Legal Shaman’s index.`
              : h.reviewCount
                ? `${h.reviewCount} review${h.reviewCount === 1 ? "" : "s"} on Legal Shaman’s index.`
                : undefined,
          }
        : null;
    return {
      id: h.sraId.startsWith("sra:") || h.sraId.includes(":") ? h.sraId : `sra:${h.sraId}`,
      name: h.name,
      blurb: matchReasonFor(mode, h, locationHint),
      url: h.profileUrl || h.website || sraRegisterUrl(h.sraId, h.name),
      phone: h.phone || undefined,
      email: h.email,
      city: h.city || undefined,
      postcode: h.postcode || undefined,
      sraId: h.sraId,
      website: h.website || undefined,
      legalAid: h.legalAid || legalAidOnly || undefined,
      publishedCosts: costs,
      reviews,
      matchReason: legalAidOnly
        ? "Matched as a legal aid provider / legal-aid flagged firm"
        : mode === "local"
          ? "Matched from the SRA register near you"
          : mode === "online"
            ? "Matched from the SRA register for online-friendly contact"
            : mode === "reviews"
              ? "Matched from the SRA register — compare reviews on Legal Shaman before instructing"
              : "Matched from the SRA register",
    };
  });

  return {
    solicitors,
    source: solicitors.length ? "sra_typesense" : "none",
    emptyReason: solicitors.length ? undefined : "no_matches",
  };
}
