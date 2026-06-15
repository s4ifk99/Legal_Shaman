import type { Listing } from "@/lib/data";
import { fetchAllListings, listings as curatedListings } from "@/lib/data";
import { prisma } from "@/lib/db/prisma";
import { lawyerInclude } from "@/lib/lawyers/lawyer-include";
import {
  buildExpandedSearchText,
  resolveLegalIssueFromQuery,
} from "@/lib/legal/taxonomy";
import { getListingSearchDocument } from "@/lib/search/listing-document";
import { sraProfileUrlForId } from "@/lib/search/sra-document";
import {
  buildSraNamePatchRecord,
  chooseSraIndexTitle,
  sraTitleSourceInputFromOrg,
} from "@/lib/search-index/sra-title-source";
import type { EntityType, LegalEntityDocument } from "@/lib/search-index/types";
import { resolveGeoForIndex } from "@/lib/search-index/geocode";
import {
  practiceAreasFromText,
  subIssuesFromSlug,
} from "@/lib/search-index/normalise-practice-area";
import { normaliseCity, normalisePostcode } from "@/lib/search-index/normalise-address";
import { applyTaxonomyProjection } from "@/lib/search-index/taxonomy-projection";
import { projectAndApplySraPracticeAreas } from "@/lib/sra/practice-area-projection";
import {
  applySraWorkAreaSlugsToDocument,
  parseSraWorkAreaField,
} from "@/lib/sra/work-area-slugs";
import { sraIndexPageSize, withDbRetry } from "@/lib/search-index/sra-index-page";
import probonoData from "@/data/probono-sources.json";

type ProBonoSourceRow = {
  id: string;
  entityType:
    | "pro_bono_organisation"
    | "law_centre"
    | "advice_charity"
    | "university_law_clinic";
  title: string;
  description: string;
  practiceAreas: string[];
  eligibility?: string;
  city?: string;
  postcode?: string;
  address?: string;
  website?: string;
  phone?: string;
  email?: string;
  openingHours?: string;
  referralRequired?: boolean;
  sourceUrl?: string;
  lastVerifiedAt?: string;
};

function profileScore(parts: {
  description?: string;
  phone?: string;
  email?: string;
  website?: string;
  city?: string;
  postcode?: string;
}): number {
  let s = 0.3;
  if (parts.description && parts.description.length > 40) s += 0.2;
  if (parts.phone) s += 0.15;
  if (parts.email) s += 0.1;
  if (parts.website) s += 0.1;
  if (parts.city) s += 0.1;
  if (parts.postcode) s += 0.15;
  return Math.min(1, s);
}

function applyGeo(
  doc: LegalEntityDocument,
  geo: { latitude: number; longitude: number; confidence: number } | null,
): void {
  if (!geo) return;
  doc.latitude = geo.latitude;
  doc.longitude = geo.longitude;
  doc.locationPoint = [geo.latitude, geo.longitude];
}

type BuildListingOptions = { skipGeo?: boolean };

async function buildListingDoc(
  listing: Listing,
  entityType: EntityType,
  source: string,
  options?: BuildListingOptions,
): Promise<LegalEntityDocument> {
  const searchText = getListingSearchDocument(listing);
  const resolution = resolveLegalIssueFromQuery(searchText);
  const expandedSearchText = buildExpandedSearchText(resolution, searchText);
  const practiceAreas = practiceAreasFromText(searchText);
  if (listing.legalAidGovCategory) practiceAreas.push(listing.legalAidGovCategory);
  if (listing.subcategory) practiceAreas.push(listing.subcategory.replace(/-/g, " "));

  const geo = options?.skipGeo
    ? null
    : await resolveGeoForIndex({
        postcode: listing.postcode,
        city: listing.city,
        address: listing.address,
      });

  const id =
    entityType === "legal_aid_provider" ? `legal_aid:${listing.id}` : `curated:${listing.id}`;

  const doc: LegalEntityDocument = {
    id,
    entityType,
    title: listing.businessName,
    description: listing.description,
    practiceAreas: [...new Set(practiceAreas)].slice(0, 12),
    categories: [listing.category, listing.subcategory].filter(Boolean),
    subIssues: subIssuesFromSlug(resolution?.taxonomySlug ?? null),
    searchText,
    expandedSearchText,
    source,
    city: listing.city || undefined,
    postcode: listing.postcode ? normalisePostcode(listing.postcode) : undefined,
    country: "United Kingdom",
    address: listing.address || undefined,
    legalAid: listing.isLegalAid === true,
    freeConsultation: listing.isFree,
    verified: false,
    website: listing.website,
    phone: listing.phone,
    email: listing.email,
    authorityScore: listing.isLegalAid ? 0.88 : 0.82,
    profileCompletenessScore: profileScore(listing),
    rawSourceId: listing.id,
    updatedAt: Date.now(),
  };
  applyGeo(doc, geo);
  return applyTaxonomyProjection(doc);
}

export async function buildCuratedDocuments(
  options?: BuildListingOptions,
): Promise<LegalEntityDocument[]> {
  const out: LegalEntityDocument[] = [];
  for (const l of curatedListings) {
    if (l.isLegalAid) continue;
    out.push(await buildListingDoc(l, "curated_listing", "curated", options));
  }
  return out;
}

export async function buildLegalAidDocuments(
  options?: BuildListingOptions,
): Promise<LegalEntityDocument[]> {
  const all = fetchAllListings();
  const out: LegalEntityDocument[] = [];
  for (const l of all) {
    if (!l.isLegalAid) continue;
    out.push(await buildListingDoc(l, "legal_aid_provider", "legal_aid", options));
  }
  return out;
}

export async function buildLawyerDocuments(): Promise<LegalEntityDocument[]> {
  let rows;
  try {
    rows = await prisma.lawyer.findMany({ include: lawyerInclude });
  } catch {
    return [];
  }
  const out: LegalEntityDocument[] = [];
  for (const lawyer of rows) {
    const loc = lawyer.locations[0];
    const searchText = [
      lawyer.name,
      lawyer.bio,
      lawyer.firm?.name,
      ...lawyer.practiceAreas.map((p) => p.practiceArea.name),
      loc?.city,
      loc?.postcode,
    ]
      .filter(Boolean)
      .join("\n");
    const resolution = resolveLegalIssueFromQuery(searchText);
    const expandedSearchText = buildExpandedSearchText(resolution, searchText);
    const geo = await resolveGeoForIndex({
      postcode: loc?.postcode,
      city: loc?.city,
      existingLat: loc?.latitude,
      existingLng: loc?.longitude,
    });

    const doc: LegalEntityDocument = {
      id: `lawyer:${lawyer.id}`,
      entityType: "lawyer",
      title: lawyer.name,
      description: lawyer.bio.slice(0, 500),
      practiceAreas: lawyer.practiceAreas.map((p) => p.practiceArea.name),
      categories: lawyer.practiceAreas.map((p) => p.practiceArea.slug),
      subIssues: subIssuesFromSlug(resolution?.taxonomySlug ?? null),
      searchText,
      expandedSearchText,
      source: "lawyer",
      city: loc?.city ? normaliseCity(loc.city) : undefined,
      postcode: loc?.postcode ? normalisePostcode(loc.postcode) : undefined,
      country: loc?.country ?? "United Kingdom",
      jurisdictions: loc ? [loc.jurisdiction] : [],
      languages: lawyer.languages.map((l) => l.language.name),
      legalAid: false,
      freeConsultation: lawyer.availability?.freeConsultation ?? false,
      remoteConsultation: lawyer.consultationOptions.some((o) =>
        /video|phone|remote/i.test(o),
      ),
      consultationOptions: [...lawyer.consultationOptions],
      verified: lawyer.verifiedCredentials,
      firmId: lawyer.firmId ?? undefined,
      profileUrl: lawyer.profileUrl ?? undefined,
      rating: lawyer.rating,
      reviewCount: lawyer.reviewCount,
      authorityScore: lawyer.verifiedCredentials ? 0.92 : 0.85,
      profileCompletenessScore: profileScore({
        description: lawyer.bio,
        website: lawyer.profileUrl ?? undefined,
        city: loc?.city,
        postcode: loc?.postcode,
      }),
      rawSourceId: lawyer.id,
      updatedAt: lawyer.updatedAt.getTime(),
    };
    applyGeo(doc, geo);
    out.push(applyTaxonomyProjection(doc));

    if (lawyer.firm && !out.some((d) => d.id === `firm:${lawyer.firm!.id}`)) {
      const f = lawyer.firm;
      const fSearch = [f.name, f.city, f.postcode, f.country].filter(Boolean).join(" ");
      const fGeo = await resolveGeoForIndex({
        postcode: f.postcode ?? undefined,
        city: f.city ?? undefined,
        existingLat: f.latitude,
        existingLng: f.longitude,
      });
      const fDoc: LegalEntityDocument = {
        id: `firm:${f.id}`,
        entityType: "firm",
        title: f.name,
        description: `Law firm${f.sraId ? " (SRA-linked)" : ""}.`,
        practiceAreas: [],
        categories: ["firm"],
        subIssues: [],
        searchText: fSearch,
        expandedSearchText: fSearch,
        source: "firm",
        city: f.city ? normaliseCity(f.city) : undefined,
        postcode: f.postcode ? normalisePostcode(f.postcode) : undefined,
        country: f.country ?? undefined,
        legalAid: false,
        verified: Boolean(f.sraId),
        sraId: f.sraId ?? undefined,
        profileUrl: f.sraProfileUrl ?? undefined,
        website: f.website ?? undefined,
        authorityScore: f.sraId ? 0.9 : 0.8,
        profileCompletenessScore: profileScore({
          city: f.city ?? undefined,
          postcode: f.postcode ?? undefined,
          website: f.website ?? undefined,
        }),
        rawSourceId: f.id,
        updatedAt: f.updatedAt.getTime(),
      };
      applyGeo(fDoc, fGeo);
      out.push(applyTaxonomyProjection(fDoc));
    }
  }
  return out;
}

export async function buildProBonoDocuments(): Promise<LegalEntityDocument[]> {
  const rows = (probonoData as { sources: ProBonoSourceRow[] }).sources ?? [];
  const out: LegalEntityDocument[] = [];

  for (const row of rows) {
    const searchText = [
      row.title,
      row.description,
      row.eligibility,
      ...row.practiceAreas,
      row.city,
    ]
      .filter(Boolean)
      .join("\n");
    const resolution = resolveLegalIssueFromQuery(searchText);
    const expandedSearchText = buildExpandedSearchText(resolution, searchText);
    const geo = await resolveGeoForIndex({
      postcode: row.postcode,
      city: row.city,
      address: row.address,
    });

    const entityType = row.entityType as EntityType;
    const descParts = [row.description];
    if (row.eligibility) descParts.push(`Eligibility: ${row.eligibility}`);
    if (row.openingHours) descParts.push(`Hours: ${row.openingHours}`);

    const doc: LegalEntityDocument = {
      id: `probono:${row.id}`,
      entityType,
      title: row.title,
      description: descParts.join(" "),
      practiceAreas: row.practiceAreas,
      categories: [row.entityType.replace(/_/g, " ")],
      subIssues: subIssuesFromSlug(resolution?.taxonomySlug ?? null),
      searchText,
      expandedSearchText,
      source: "probono",
      city: row.city ? normaliseCity(row.city) : undefined,
      postcode: row.postcode ? normalisePostcode(row.postcode) : undefined,
      country: "United Kingdom",
      address: row.address,
      legalAid: row.entityType === "law_centre",
      freeConsultation: true,
      verified: Boolean(row.lastVerifiedAt),
      website: row.website,
      phone: row.phone,
      email: row.email,
      profileUrl: row.website,
      authorityScore: row.entityType === "law_centre" ? 0.9 : 0.86,
      profileCompletenessScore: profileScore(row),
      rawSourceId: row.id,
      updatedAt: row.lastVerifiedAt
        ? Date.parse(row.lastVerifiedAt) || Date.now()
        : Date.now(),
    };
    applyGeo(doc, geo);
    out.push(applyTaxonomyProjection(doc));
  }
  return out;
}

export type BuildSraDocumentsOptions = {
  /** Cap rows loaded (default 50_000 for full index sync). */
  take?: number;
  /** Skip geocode DB lookups — use existing coordinates only (faster for crawl CLI). */
  skipGeo?: boolean;
  /** Load only these SRA numbers (partial Typesense reindex). */
  sraIds?: string[];
  /** Canonical firm.name from firms table (overrides stale org display_name). */
  firmBusinessName?: string | null;
};

type SraOrgRow = Awaited<ReturnType<typeof prisma.sraOrganisation.findMany>>[number];

export async function sraOrganisationToDocument(
  org: SraOrgRow,
  options?: BuildSraDocumentsOptions,
): Promise<LegalEntityDocument> {
  const searchText = org.searchText || org.businessName;
  const websiteFromColumn = org.website?.trim();
  const websiteMatch = searchText.match(/https?:\/\/[^\s,)]+/i);
  const website = websiteFromColumn || websiteMatch?.[0];
  const emailFromColumn = org.email?.trim();
  const emailMatch = searchText.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  const email = emailFromColumn || emailMatch?.[0];
  const resolution = resolveLegalIssueFromQuery(searchText);
  const expandedSearchText = buildExpandedSearchText(resolution, searchText);
  const geo = options?.skipGeo
    ? null
    : await resolveGeoForIndex({
        postcode: org.postcode,
        city: org.city,
        existingLat: org.latitude,
        existingLng: org.longitude,
      });
  const { title: displayName } = chooseSraIndexTitle(
    sraTitleSourceInputFromOrg(org, options?.firmBusinessName),
  );
  const doc: LegalEntityDocument = {
    id: `sra:${org.sraId}`,
    entityType: "sra_organisation",
    title: displayName,
    displayName,
    organisationName: org.organisationName || undefined,
    tradingName: org.tradingName || undefined,
    firmName: options?.firmBusinessName?.trim() || org.firmName || undefined,
    exactTitle: displayName,
    description: searchText.slice(0, 400),
    phone: org.phone?.trim() || undefined,
    contactSource: org.phone?.trim() ? "sra_register" : undefined,
    contactConfidence: org.phone?.trim() ? 0.92 : undefined,
    practiceAreas: practiceAreasFromText(searchText, { includeRelated: false }),
    categories: ["SRA organisation"],
    subIssues: subIssuesFromSlug(resolution?.taxonomySlug ?? null),
    searchText,
    expandedSearchText,
    source: "sra",
    city: org.normalizedCity || org.city || undefined,
    postcode: org.normalizedPostcode
      ? normalisePostcode(org.normalizedPostcode)
      : org.postcode
        ? normalisePostcode(org.postcode)
        : undefined,
    website,
    email,
    country: org.country || "United Kingdom",
    address:
      org.normalizedAddress || [org.city, org.county, org.postcode].filter(Boolean).join(", ") ||
      undefined,
    legalAid: false,
    verified: true,
    sraId: org.sraId,
    sraOrganisationId: org.sraId,
    sraNumber: org.sraId,
    exactSraId: org.sraId,
    contactPageUrl: org.sraProfileUrl || sraProfileUrlForId(org.sraId),
    profileUrl: org.sraProfileUrl || sraProfileUrlForId(org.sraId),
    authorityScore: 0.78,
    profileCompletenessScore: profileScore(org),
    rawSourceId: org.sraId,
    updatedAt: org.updatedAt.getTime(),
  };
  if (options?.skipGeo && org.latitude != null && org.longitude != null) {
    doc.latitude = org.latitude;
    doc.longitude = org.longitude;
    doc.locationPoint = [org.latitude, org.longitude];
  } else {
    applyGeo(doc, geo);
  }

  const workAreas = parseSraWorkAreaField(org.workArea);
  if (workAreas.length > 0) {
    applySraWorkAreaSlugsToDocument(doc, workAreas);
  } else {
    projectAndApplySraPracticeAreas(doc);
  }

  return applyTaxonomyProjection(doc);
}

export async function buildSingleSraDocument(
  entityId: string,
  options?: BuildSraDocumentsOptions,
): Promise<LegalEntityDocument | null> {
  const sraId = entityId.replace(/^sra:/, "").replace(/^sra-/, "");
  try {
    const org = await prisma.sraOrganisation.findFirst({
      where: {
        OR: [{ sraId }, { id: entityId }, { id: `sra-${sraId}` }],
      },
    });
    if (!org) return null;
    const firm = await prisma.firm.findFirst({
      where: { sraId: org.sraId },
      select: { name: true },
    });
    return sraOrganisationToDocument(org, { ...options, firmBusinessName: firm?.name ?? null });
  } catch {
    return null;
  }
}

export type FetchSraOrganisationPageOptions = {
  cursor?: string;
  take: number;
  sraIds?: string[];
};

export async function fetchSraOrganisationPage(
  options: FetchSraOrganisationPageOptions,
): Promise<SraOrgRow[]> {
  const where = options.sraIds?.length
    ? { sraId: { in: options.sraIds } }
    : options.cursor
      ? { sraId: { gt: options.cursor } }
      : {};

  return withDbRetry("sraOrganisation.findMany", () =>
    prisma.sraOrganisation.findMany({
      where,
      orderBy: { sraId: "asc" },
      take: options.take,
    }),
  );
}

export async function fetchFirmNamesForSraIds(sraIds: string[]): Promise<Map<string, string>> {
  if (!sraIds.length) return new Map();
  const firmRows = await withDbRetry("firm.findMany", () =>
    prisma.firm.findMany({
      where: { sraId: { in: sraIds } },
      select: { sraId: true, name: true },
    }),
  );
  return new Map(firmRows.filter((f) => f.sraId).map((f) => [f.sraId!, f.name]));
}

export async function buildSraDocumentsForOrgs(
  rows: SraOrgRow[],
  firmBySraId: Map<string, string>,
  options?: BuildSraDocumentsOptions,
): Promise<LegalEntityDocument[]> {
  const out: LegalEntityDocument[] = [];
  for (const org of rows) {
    out.push(
      await sraOrganisationToDocument(org, {
        ...options,
        firmBusinessName: firmBySraId.get(org.sraId) ?? null,
      }),
    );
  }
  return out;
}

export async function buildSraDocuments(
  options?: BuildSraDocumentsOptions,
): Promise<LegalEntityDocument[]> {
  if (options?.sraIds?.length) {
    try {
      const rows = await fetchSraOrganisationPage({
        take: options.sraIds.length,
        sraIds: options.sraIds,
      });
      const firmBySraId = await fetchFirmNamesForSraIds(rows.map((r) => r.sraId));
      return buildSraDocumentsForOrgs(rows, firmBySraId, options);
    } catch {
      return [];
    }
  }

  const pageSize = sraIndexPageSize();
  const hardLimit = options?.take;
  const out: LegalEntityDocument[] = [];
  let cursor: string | undefined;
  let loaded = 0;

  try {
    while (true) {
      const remaining = hardLimit != null ? hardLimit - loaded : pageSize;
      if (hardLimit != null && remaining <= 0) break;
      const take = hardLimit != null ? Math.min(pageSize, remaining) : pageSize;

      const rows = await fetchSraOrganisationPage({ cursor, take });
      if (!rows.length) break;

      const firmBySraId = await fetchFirmNamesForSraIds(rows.map((r) => r.sraId));
      out.push(...(await buildSraDocumentsForOrgs(rows, firmBySraId, options)));

      loaded += rows.length;
      cursor = rows[rows.length - 1]!.sraId;
      if (rows.length < take) break;
    }
  } catch {
    return out;
  }

  return out;
}

/** Minimal partial update for SRA title/name patch (avoids Typesense OOM). */
export function documentToTypesenseSraNamePatch(doc: LegalEntityDocument): Record<string, unknown> {
  return buildSraNamePatchRecord({
    entityId: doc.id,
    title: doc.displayName ?? doc.title,
  });
}

export function documentToTypesenseRecord(doc: LegalEntityDocument): Record<string, unknown> {
  const rec: Record<string, unknown> = {
    id: doc.id,
    entityType: doc.entityType,
    title: doc.title,
    displayName: doc.displayName ?? doc.title,
    organisationName: doc.organisationName ?? "",
    tradingName: doc.tradingName ?? "",
    firmName: doc.firmName ?? "",
    description: doc.description,
    practiceAreas: doc.practiceAreas,
    practiceAreaSlugs: doc.practiceAreaSlugs ?? [],
    relatedPracticeAreas: doc.relatedPracticeAreas ?? [],
    taxonomyAliases: doc.taxonomyAliases ?? [],
    taxonomyProjectionMatches: doc.taxonomyProjectionMatches ?? [],
    sraProjectionConfidence: doc.sraProjectionConfidence ?? 0,
    employmentProjectionConfidence: doc.employmentProjectionConfidence ?? 0,
    categories: doc.categories,
    subIssues: doc.subIssues,
    searchText: doc.searchText,
    expandedSearchText: doc.expandedSearchText,
    userSearchText: doc.userSearchText ?? "",
    legalSearchText: doc.legalSearchText ?? "",
    capabilitySearchText: doc.capabilitySearchText ?? "",
    provenanceSearchText: doc.provenanceSearchText ?? "",
    geoSearchText: doc.geoSearchText ?? "",
    issueAliases: doc.issueAliases ?? [],
    legalTerms: doc.legalTerms ?? [],
    userPhrases: doc.userPhrases ?? [],
    fundingTerms: doc.fundingTerms ?? [],
    urgencyTerms: doc.urgencyTerms ?? [],
    tribunalTerms: doc.tribunalTerms ?? [],
    languageTerms: doc.languageTerms ?? [],
    accessibilityTerms: doc.accessibilityTerms ?? [],
    exactTitle: doc.exactTitle ?? "",
    exactPostcode: doc.exactPostcode ?? "",
    exactCity: doc.exactCity ?? "",
    exactSraId: doc.exactSraId ?? "",
    indexQualityScore: doc.indexQualityScore ?? 0,
    providerCompletenessScore: doc.providerCompletenessScore ?? 0,
    contactPageUrl: doc.contactPageUrl ?? "",
    source: doc.source,
    city: doc.city ?? "",
    postcode: doc.postcode ?? "",
    country: doc.country ?? "",
    address: doc.address ?? "",
    jurisdictions: doc.jurisdictions ?? [],
    languages: doc.languages ?? [],
    legalAid: doc.legalAid,
    freeConsultation: doc.freeConsultation ?? false,
    remoteConsultation: doc.remoteConsultation ?? false,
    verified: doc.verified ?? false,
    sraId: doc.sraId ?? "",
    sraOrganisationId: doc.sraOrganisationId ?? doc.sraId ?? "",
    sraNumber: doc.sraNumber ?? doc.sraId ?? "",
    firmId: doc.firmId ?? "",
    profileUrl: doc.profileUrl ?? "",
    website: doc.website ?? "",
    phone: doc.phone ?? "",
    email: doc.email ?? "",
    capabilities: doc.capabilities ?? [],
    fundingCapabilities: doc.fundingCapabilities ?? [],
    urgencyCapabilities: doc.urgencyCapabilities ?? [],
    accessibilityCapabilities: doc.accessibilityCapabilities ?? [],
    tribunalCapabilities: doc.tribunalCapabilities ?? [],
    contactConfidence: doc.contactConfidence ?? 0,
    contactSource: doc.contactSource ?? "",
    enrichmentStatus: doc.enrichmentStatus ?? "",
    authorityScore: doc.authorityScore,
    profileCompletenessScore: doc.profileCompletenessScore,
    rating: doc.rating ?? 0,
    reviewCount: doc.reviewCount ?? 0,
    rawSourceId: doc.rawSourceId,
    updatedAt: doc.updatedAt,
  };
  if (doc.locationPoint) {
    rec.locationPoint = doc.locationPoint;
  }
  if (doc.embedding?.length) rec.embedding = doc.embedding;
  if (doc.embedding1536?.length) rec.embedding1536 = doc.embedding1536;
  return rec;
}
