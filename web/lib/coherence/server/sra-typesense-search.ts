import "server-only";

import { LEGAL_ENTITIES_COLLECTION, typesenseConfigured } from "@/lib/search-index/config";
import { searchLegalEntitiesMulti } from "@/lib/search-index/typesense-legal-entities-search";
import { buildTypesenseListingsClientFromEnv } from "@/lib/search/typesense-listings-client";
import { sraProfileUrlForId } from "@/lib/search/sra-document";
import { sraOrganisationAdmissible } from "@/lib/matter/graphAdmissibility";
import { scoreSraWorkAreaForMatching, type SraSearchPayload } from "@/lib/coherence/sraQuery";

export type CoherenceSraHit = {
  sraId: string;
  name: string;
  city: string;
  postcode: string;
  phone: string;
  website: string;
  profileUrl: string;
  workArea: string;
  score: number;
  email?: string;
  legalAid?: boolean;
  rating?: number;
  reviewCount?: number;
  fundingCapabilities?: string[];
};

function typesenseQueryForFlags(
  flags: Pick<
    SraSearchPayload,
    | "wantHousing"
    | "wantEmployment"
    | "wantImmigration"
    | "wantConsumer"
    | "wantCar"
    | "wantMotoring"
    | "wantDefamation"
    | "wantFamily"
    | "wantDebt"
    | "wantPersonalInjury"
    | "wantLitigation"
    | "wantCrime"
    | "query"
    | "matterType"
  >,
): string {
  if (flags.wantDefamation) return "defamation libel media litigation reputation";
  if (flags.wantFamily) return "family divorce children matrimonial domestic";
  if (flags.wantDebt) return "debt insolvency bankruptcy creditor bailiff";
  if (flags.wantPersonalInjury) return "personal injury clinical negligence accident claim";
  if (flags.wantHousing) return "housing landlord tenant eviction residential property";
  if (flags.wantEmployment) return "employment workplace tribunal wages";
  if (flags.wantImmigration) return "immigration asylum nationality visa";
  if (flags.wantMotoring) return "motoring criminal road traffic";
  if (flags.wantCrime || flags.matterType === "crime") {
    return "criminal defence police station magistrates duty solicitor";
  }
  if (flags.wantConsumer || flags.wantCar) return "consumer litigation goods trader";
  if (flags.wantLitigation) return "civil litigation dispute solicitor";
  return String(flags.query || "solicitor").slice(0, 80);
}

function workAreaFromDoc(doc: Record<string, unknown>): string {
  const areas = [
    ...(Array.isArray(doc.practiceAreas) ? (doc.practiceAreas as unknown[]).map(String) : []),
    ...(Array.isArray(doc.practiceAreaSlugs) ? (doc.practiceAreaSlugs as unknown[]).map(String) : []),
  ];
  return areas.join(", ");
}

export async function typesenseSraStatus(): Promise<{
  configured: boolean;
  reachable: boolean;
  total?: number;
  error?: string;
}> {
  if (!typesenseConfigured()) {
    return { configured: false, reachable: false, error: "typesense_not_configured" };
  }
  const client = buildTypesenseListingsClientFromEnv();
  if (!client) {
    return { configured: false, reachable: false, error: "typesense_not_configured" };
  }
  try {
    const res = await client.collections(LEGAL_ENTITIES_COLLECTION).documents().search({
      q: "*",
      query_by: "title",
      filter_by: "entityType:=`sra_organisation`",
      per_page: 1,
    });
    const found = Number((res as { found?: number }).found || 0);
    return { configured: true, reachable: found > 0, total: found };
  } catch (err) {
    return {
      configured: true,
      reachable: false,
      error: err instanceof Error ? err.message : "typesense_search_failed",
    };
  }
}

export async function searchSraOrganisationsTypesense(opts: {
  flags: Pick<
    SraSearchPayload,
    | "wantHousing"
    | "wantEmployment"
    | "wantImmigration"
    | "wantConsumer"
    | "wantCar"
    | "wantMotoring"
    | "wantDefamation"
    | "wantFamily"
    | "wantDebt"
    | "wantPersonalInjury"
    | "wantLitigation"
    | "wantCrime"
    | "query"
    | "matterType"
  >;
  limit: number;
  minScore: number;
  /** Prefer / require legal-aid flagged firms and providers. */
  legalAidOnly?: boolean;
}): Promise<CoherenceSraHit[]> {
  if (!typesenseConfigured()) return [];
  const q = typesenseQueryForFlags(opts.flags);
  const filterBy = opts.legalAidOnly
    ? "legalAid:=true && entityType:=[`sra_organisation`,`legal_aid_provider`,`law_centre`]"
    : "entityType:=`sra_organisation`";
  const { hits } = await searchLegalEntitiesMulti({
    q,
    expandedQ: q,
    limit: Math.min(40, Math.max(opts.limit * 6, 12)),
    filterBy,
  });

  const ranked: CoherenceSraHit[] = [];
  for (const hit of hits) {
    const doc = hit.document;
    const sraId = String(doc.sraId || doc.exactSraId || doc.id || "").trim();
    if (!sraId && !opts.legalAidOnly) continue;
    const workArea = workAreaFromDoc(doc);
    const hay = `${workArea} ${String(doc.title || "")} ${String(doc.searchText || "")}`;
    let score = scoreSraWorkAreaForMatching(hay, opts.flags);
    const phone = String(doc.phone || "").trim();
    if (phone) score += 8;
    if (doc.legalAid === true) score += 6;
    if (score < opts.minScore) continue;
    const name = String(doc.title || doc.displayName || `SRA ${sraId || "firm"}`);
    if (!sraOrganisationAdmissible(name)) continue;
    const ratingRaw = Number(doc.rating);
    const reviewCountRaw = Number(doc.reviewCount);
    const funding = Array.isArray(doc.fundingCapabilities)
      ? (doc.fundingCapabilities as unknown[]).map(String)
      : [];
    ranked.push({
      sraId: sraId || String(doc.id || name),
      name,
      city: String(doc.city || ""),
      postcode: String(doc.postcode || ""),
      phone,
      website: String(doc.website || ""),
      profileUrl: String(doc.profileUrl || doc.contactPageUrl || (sraId ? sraProfileUrlForId(sraId) : "")),
      workArea,
      score,
      email: String(doc.email || "").trim() || undefined,
      legalAid: doc.legalAid === true,
      rating: Number.isFinite(ratingRaw) && ratingRaw > 0 ? ratingRaw : undefined,
      reviewCount:
        Number.isFinite(reviewCountRaw) && reviewCountRaw > 0 ? reviewCountRaw : undefined,
      fundingCapabilities: funding,
    });
  }

  ranked.sort(
    (a, b) =>
      b.score - a.score ||
      (b.phone ? 1 : 0) - (a.phone ? 1 : 0) ||
      a.name.localeCompare(b.name),
  );
  const seen = new Set<string>();
  const out: CoherenceSraHit[] = [];
  for (const row of ranked) {
    if (seen.has(row.sraId)) continue;
    seen.add(row.sraId);
    out.push(row);
    if (out.length >= opts.limit) break;
  }
  return out;
}
