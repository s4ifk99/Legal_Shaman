import Typesense from "typesense";
import type { CollectionFieldSchema } from "typesense";
import { LEGAL_ENTITIES_COLLECTION } from "@/lib/search-index/config";

type TsClient = InstanceType<typeof Typesense.Client>;

export const legalEntitiesFields: CollectionFieldSchema[] = [
  { name: "id", type: "string" },
  { name: "entityType", type: "string", facet: true },
  { name: "title", type: "string" },
  { name: "description", type: "string", optional: true },
  { name: "practiceAreas", type: "string[]", facet: true, optional: true },
  { name: "practiceAreaSlugs", type: "string[]", facet: true, optional: true },
  { name: "relatedPracticeAreas", type: "string[]", facet: true, optional: true },
  { name: "taxonomyAliases", type: "string[]", optional: true },
  { name: "taxonomyProjectionMatches", type: "string[]", optional: true },
  { name: "sraProjectionConfidence", type: "float", optional: true },
  { name: "employmentProjectionConfidence", type: "float", optional: true },
  { name: "categories", type: "string[]", facet: true, optional: true },
  { name: "subIssues", type: "string[]", optional: true },
  { name: "searchText", type: "string", optional: true },
  { name: "expandedSearchText", type: "string", optional: true },
  { name: "userSearchText", type: "string", optional: true },
  { name: "legalSearchText", type: "string", optional: true },
  { name: "capabilitySearchText", type: "string", optional: true },
  { name: "provenanceSearchText", type: "string", optional: true },
  { name: "geoSearchText", type: "string", optional: true },
  { name: "issueAliases", type: "string[]", optional: true },
  { name: "legalTerms", type: "string[]", optional: true },
  { name: "userPhrases", type: "string[]", optional: true },
  { name: "fundingTerms", type: "string[]", optional: true },
  { name: "urgencyTerms", type: "string[]", optional: true },
  { name: "tribunalTerms", type: "string[]", optional: true },
  { name: "languageTerms", type: "string[]", optional: true },
  { name: "accessibilityTerms", type: "string[]", optional: true },
  { name: "exactTitle", type: "string", optional: true },
  { name: "exactPostcode", type: "string", optional: true },
  { name: "exactCity", type: "string", optional: true },
  { name: "exactSraId", type: "string", optional: true },
  { name: "indexQualityScore", type: "float", optional: true },
  { name: "providerCompletenessScore", type: "float", optional: true },
  { name: "contactPageUrl", type: "string", optional: true },
  { name: "source", type: "string", facet: true, optional: true },
  { name: "city", type: "string", facet: true, optional: true },
  { name: "postcode", type: "string", optional: true },
  { name: "country", type: "string", facet: true, optional: true },
  { name: "address", type: "string", optional: true },
  { name: "locationPoint", type: "geopoint", optional: true },
  { name: "jurisdictions", type: "string[]", optional: true },
  { name: "languages", type: "string[]", facet: true, optional: true },
  { name: "legalAid", type: "bool", facet: true },
  { name: "freeConsultation", type: "bool", optional: true },
  { name: "remoteConsultation", type: "bool", optional: true },
  { name: "verified", type: "bool", facet: true, optional: true },
  { name: "sraId", type: "string", optional: true },
  { name: "firmId", type: "string", optional: true },
  { name: "profileUrl", type: "string", optional: true },
  { name: "website", type: "string", optional: true },
  { name: "phone", type: "string", optional: true },
  { name: "email", type: "string", optional: true },
  { name: "capabilities", type: "string[]", facet: true, optional: true },
  { name: "fundingCapabilities", type: "string[]", facet: true, optional: true },
  { name: "urgencyCapabilities", type: "string[]", facet: true, optional: true },
  { name: "accessibilityCapabilities", type: "string[]", facet: true, optional: true },
  { name: "tribunalCapabilities", type: "string[]", facet: true, optional: true },
  { name: "contactConfidence", type: "float", optional: true },
  { name: "contactSource", type: "string", facet: true, optional: true },
  { name: "enrichmentStatus", type: "string", facet: true, optional: true },
  { name: "authorityScore", type: "float" },
  { name: "profileCompletenessScore", type: "float" },
  { name: "rating", type: "float", optional: true },
  { name: "reviewCount", type: "int32", optional: true },
  { name: "rawSourceId", type: "string", optional: true },
  { name: "updatedAt", type: "int64" },
];

const INDEX_SCHEMA_PATCH_FIELDS: CollectionFieldSchema[] = legalEntitiesFields.filter((f) =>
  [
    "userSearchText",
    "legalSearchText",
    "capabilitySearchText",
    "provenanceSearchText",
    "geoSearchText",
    "issueAliases",
    "legalTerms",
    "userPhrases",
    "fundingTerms",
    "urgencyTerms",
    "tribunalTerms",
    "languageTerms",
    "accessibilityTerms",
    "exactTitle",
    "exactPostcode",
    "exactCity",
    "exactSraId",
    "indexQualityScore",
    "providerCompletenessScore",
    "contactPageUrl",
  ].includes(f.name),
);

export async function ensureLegalEntitiesCollection(client: TsClient): Promise<void> {
  try {
    const col = await client.collections(LEGAL_ENTITIES_COLLECTION).retrieve();
    const existing = new Set(
      ((col as { fields?: { name: string }[] }).fields ?? []).map((f) => f.name),
    );
    const toAdd = INDEX_SCHEMA_PATCH_FIELDS.filter((f) => !existing.has(f.name));
    if (toAdd.length) {
      await client.collections(LEGAL_ENTITIES_COLLECTION).update({ fields: toAdd });
    }
  } catch (e: unknown) {
    const http = (e as { httpStatus?: number })?.httpStatus;
    if (http !== 404) throw e;
    await client.collections().create({
      name: LEGAL_ENTITIES_COLLECTION,
      fields: legalEntitiesFields,
      default_sorting_field: "authorityScore",
    });
  }
}

export async function typesenseServerHealth(client: TsClient): Promise<{
  ok: boolean;
  version?: string;
}> {
  try {
    const h = await client.health.retrieve();
    return { ok: true, version: (h as { version?: string }).version };
  } catch {
    return { ok: false };
  }
}
