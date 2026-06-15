import type { LegalEntityDocument } from "@/lib/search-index/types";
import { computeIndexQualityScore } from "@/lib/search-index/index-quality-score";
import {
  GLOBAL_ACCESSIBILITY_TERMS,
  GLOBAL_FUNDING_TERMS,
  GLOBAL_LANGUAGE_TERMS,
  GLOBAL_TRIBUNAL_TERMS,
  GLOBAL_URGENCY_TERMS,
  mergePhraseExpansions,
} from "@/lib/search-index/query-phrase-expansion";
import { normalisePostcode } from "@/lib/search-index/normalise-address";
import { practiceAreasFromText } from "@/lib/search-index/normalise-practice-area";

function uniqueStrings(items: string[], max = 64): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of items) {
    const t = s.trim();
    if (t.length < 2) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

function joinText(parts: string[], maxLen = 4000): string {
  return uniqueStrings(parts).join(" ").slice(0, maxLen);
}

function capabilityLabels(doc: LegalEntityDocument): string[] {
  const labels: string[] = [];
  const map: Record<string, string> = {
    "funding.legal_aid": "legal aid",
    "funding.pro_bono": "pro bono",
    "funding.fixed_fee": "fixed fee",
    "funding.no_win_no_fee": "no win no fee",
    "urgency.same_day": "same day urgent",
    "urgency.emergency": "emergency",
    "tribunal.employment": "employment tribunal",
    "tribunal.immigration": "immigration tribunal",
    "tribunal.send": "SEND tribunal",
    "accessibility.remote_consultation": "remote consultation",
    "accessibility.interpreter": "interpreter",
  };
  const all = [
    ...(doc.capabilities ?? []),
    ...(doc.fundingCapabilities ?? []),
    ...(doc.urgencyCapabilities ?? []),
    ...(doc.tribunalCapabilities ?? []),
    ...(doc.accessibilityCapabilities ?? []),
  ];
  for (const c of all) {
    labels.push(map[c] ?? c.replace(/\./g, " ").replace(/_/g, " "));
  }
  return uniqueStrings(labels);
}

function provenanceLabels(doc: LegalEntityDocument): string[] {
  const et = doc.entityType;
  const labels: string[] = [doc.source];
  switch (et) {
    case "sra_organisation":
      labels.push("SRA", "SRA regulated", "solicitor firm", "law firm", "regulated firm");
      break;
    case "legal_aid_provider":
      labels.push("legal aid", "GOV.UK legal aid", "legal aid provider", "Civil Legal Aid");
      break;
    case "law_centre":
      labels.push("law centre", "free legal advice", "legal aid");
      break;
    case "lawyer":
      labels.push("solicitor", "lawyer", "private practice");
      break;
    case "firm":
      labels.push("law firm", "solicitors");
      break;
    case "pro_bono_organisation":
      labels.push("pro bono", "free legal help");
      break;
    case "advice_charity":
      labels.push("advice charity", "Citizens Advice style", "free advice");
      break;
    case "university_law_clinic":
      labels.push("law clinic", "university law clinic", "pro bono");
      break;
    case "curated_listing":
      labels.push("curated listing", "verified listing");
      break;
    default:
      break;
  }
  if (doc.legalAid) labels.push("legal aid", "legal aid funded");
  if (doc.freeConsultation) labels.push("free consultation");
  return uniqueStrings(labels);
}

function geoLabels(doc: LegalEntityDocument): string[] {
  const parts: string[] = [];
  if (doc.city) parts.push(doc.city, `city ${doc.city}`);
  if (doc.postcode) {
    parts.push(doc.postcode, normalisePostcode(doc.postcode));
  }
  if (doc.address) parts.push(doc.address);
  if (doc.country) parts.push(doc.country);
  return uniqueStrings(parts);
}

function exactFields(doc: LegalEntityDocument): {
  exactTitle: string;
  exactPostcode: string;
  exactCity: string;
  exactSraId: string;
} {
  return {
    exactTitle: doc.title.trim().toLowerCase(),
    exactPostcode: doc.postcode ? normalisePostcode(doc.postcode) : "",
    exactCity: (doc.city ?? "").trim().toLowerCase(),
    exactSraId: (doc.sraId ?? "").trim(),
  };
}

function websiteFromSearchText(text: string): string {
  const m = text.match(/https?:\/\/[^\s,)]+/i);
  return m?.[0] ?? "";
}

function sraRichText(doc: LegalEntityDocument): string[] {
  if (doc.entityType !== "sra_organisation") return [];
  const website = doc.website || websiteFromSearchText(doc.searchText);
  return [
    doc.title,
    doc.searchText,
    doc.description,
    website,
    doc.address ?? "",
    doc.city ?? "",
    doc.postcode ?? "",
    doc.profileUrl ?? "",
    ...(doc.categories ?? []),
    ...(doc.taxonomyAliases ?? []),
    ...(doc.relatedPracticeAreas ?? []),
    ...(doc.practiceAreas ?? []),
  ];
}

/**
 * Enrich a legal entity document with semantic index fields for Typesense.
 * Call after projection, capabilities, and approved enrichments are applied.
 */
export function enrichLegalEntityForIndex(doc: LegalEntityDocument): LegalEntityDocument {
  const inferredSlugs = practiceAreasFromText(
    [doc.searchText, doc.description, ...doc.practiceAreas].filter(Boolean).join("\n"),
    { includeRelated: false },
  );
  const slugs = uniqueStrings([...(doc.practiceAreaSlugs ?? []), ...inferredSlugs]);
  const phraseExp = mergePhraseExpansions(slugs);

  const issueAliases = uniqueStrings([
    ...phraseExp.issueAliases,
    ...(doc.taxonomyAliases ?? []),
    ...doc.practiceAreas,
    ...(doc.relatedPracticeAreas ?? []),
    ...doc.categories,
    ...slugs.map((s) => s.replace(/_/g, " ")),
  ]);

  const legalTerms = uniqueStrings([
    ...phraseExp.legalTerms,
    ...phraseExp.emergencyPhrases,
    ...(doc.subIssues ?? []),
    ...doc.practiceAreas,
    ...issueAliases.slice(0, 24),
  ]);

  const userPhrases = uniqueStrings([
    ...phraseExp.userPhrases,
    ...phraseExp.emergencyPhrases,
    ...issueAliases.filter((a) => a.split(/\s+/).length >= 2).slice(0, 12),
    ...(slugs.length === 0
      ? ["need legal advice", "find a lawyer", "legal help", "solicitor"]
      : []),
  ]);

  const fundingTerms = uniqueStrings([
    ...GLOBAL_FUNDING_TERMS,
    ...(doc.legalAid ? ["legal aid", "legal aid provider"] : []),
    ...(doc.freeConsultation ? ["free consultation"] : []),
    ...(doc.fundingCapabilities ?? []).map((c) => c.replace(/\./g, " ")),
  ]);

  const urgencyTerms = uniqueStrings([
    ...GLOBAL_URGENCY_TERMS,
    ...(doc.urgencyCapabilities ?? []).map((c) => c.replace(/\./g, " ")),
  ]);

  const tribunalTerms = uniqueStrings([
    ...GLOBAL_TRIBUNAL_TERMS,
    ...(doc.tribunalCapabilities ?? []).map((c) => c.replace(/\./g, " ")),
  ]);

  const languageTerms = uniqueStrings([
    ...GLOBAL_LANGUAGE_TERMS,
    ...(doc.languages ?? []),
  ]);

  const accessibilityTerms = uniqueStrings([
    ...GLOBAL_ACCESSIBILITY_TERMS,
    ...(doc.accessibilityCapabilities ?? []).map((c) => c.replace(/\./g, " ")),
    doc.remoteConsultation ? "remote consultation video call" : "",
  ]);

  const capLabels = capabilityLabels(doc);
  const provLabels = provenanceLabels(doc);
  const geo = geoLabels(doc);

  const userSearchText = joinText([
    ...userPhrases,
    ...phraseExp.relatedAreas,
    ...sraRichText(doc),
  ]);

  const legalSearchText = joinText([
    ...legalTerms,
    ...issueAliases,
    ...doc.subIssues,
    ...slugs.map((s) => s.replace(/_/g, " ")),
  ]);

  const capabilitySearchText = joinText([
    ...capLabels,
    ...fundingTerms,
    ...urgencyTerms,
    ...tribunalTerms,
    ...languageTerms,
    ...accessibilityTerms,
    ...phraseExp.capabilityPhrases,
  ]);

  const provenanceSearchText = joinText(provLabels);
  const geoSearchText = joinText(geo);

  const expandedSearchText = joinText([
    doc.title,
    doc.searchText,
    doc.description,
    userSearchText,
    legalSearchText,
    capabilitySearchText,
    provenanceSearchText,
    geoSearchText,
    doc.expandedSearchText ?? "",
  ]);

  const exact = exactFields(doc);

  const enriched: LegalEntityDocument = {
    ...doc,
    issueAliases,
    legalTerms,
    userPhrases,
    fundingTerms,
    urgencyTerms,
    tribunalTerms,
    languageTerms,
    accessibilityTerms,
    userSearchText,
    legalSearchText,
    capabilitySearchText,
    provenanceSearchText,
    geoSearchText,
    expandedSearchText,
    ...exact,
  };

  enriched.indexQualityScore = computeIndexQualityScore(enriched);
  return enriched;
}
