import {
  extractEmailFromText,
  extractPhonesFromText,
  extractWebsiteFromText,
} from "@/lib/provider-enrichment/contact-extractor";
import type { CrawlSourceType, ExtractedFieldCandidate } from "@/lib/provider-crawler/types";
import { crawlConfidenceForSource } from "@/lib/provider-crawler/provenance";

const UK_POSTCODE =
  /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i;

const OPENING_HOURS =
  /(?:monday|mon|tuesday|tues|wednesday|wed|thursday|thur|friday|fri|saturday|sat|sunday|sun)[^.]{0,80}(?:\d{1,2}[:.]\d{2}|\d{1,2}\s*(?:am|pm))/gi;

const PLACEHOLDER_PHONE = /^(0{6,}|123456|00000|99999|0123456789)$/i;

export function isValidUkPhoneValue(e164: string): boolean {
  const digits = e164.replace(/\D/g, "");
  if (PLACEHOLDER_PHONE.test(digits.replace(/^44/, ""))) return false;
  if (!e164.startsWith("+44")) return false;
  return digits.length >= 11 && digits.length <= 13;
}

export function extractContactFieldsFromText(
  text: string,
  ctx: {
    entityId: string;
    entityType: string;
    sourceUrl?: string;
    sourceType: CrawlSourceType;
    officialPage?: boolean;
  },
): ExtractedFieldCandidate[] {
  const out: ExtractedFieldCandidate[] = [];
  const extractedAt = new Date();

  const phones = extractPhonesFromText(text, { officialPage: ctx.officialPage });
  const bestPhone = phones.find((p) => isValidUkPhoneValue(p.e164));
  if (bestPhone) {
    const confidence = crawlConfidenceForSource(ctx.sourceType, bestPhone.confidence);
    out.push({
      entityId: ctx.entityId,
      entityType: ctx.entityType,
      fieldName: "phone",
      extractedValue: bestPhone.e164,
      confidence,
      sourceUrl: ctx.sourceUrl,
      sourceType: ctx.sourceType,
      extractionMethod: "libphonenumber",
      provenanceNote: bestPhone.evidence,
      extractedAt,
    });
  }

  const email = extractEmailFromText(text);
  if (email) {
    out.push({
      entityId: ctx.entityId,
      entityType: ctx.entityType,
      fieldName: "email",
      extractedValue: email.email,
      confidence: crawlConfidenceForSource(ctx.sourceType, email.confidence),
      sourceUrl: ctx.sourceUrl,
      sourceType: ctx.sourceType,
      extractionMethod: "regex",
      extractedAt,
    });
  }

  const website = extractWebsiteFromText(text, ctx.sourceUrl);
  if (website && ctx.sourceUrl) {
    out.push({
      entityId: ctx.entityId,
      entityType: ctx.entityType,
      fieldName: "website",
      extractedValue: website,
      confidence: crawlConfidenceForSource(ctx.sourceType, 0.9),
      sourceUrl: ctx.sourceUrl,
      sourceType: ctx.sourceType,
      extractionMethod: "html_parse",
      extractedAt,
    });
  }

  const postcodeMatch = text.match(UK_POSTCODE);
  if (postcodeMatch) {
    const idx = text.indexOf(postcodeMatch[0]);
    const slice = text.slice(Math.max(0, idx - 120), idx + postcodeMatch[0].length + 20);
    if (slice.length > 15 && slice.length < 300) {
      out.push({
        entityId: ctx.entityId,
        entityType: ctx.entityType,
        fieldName: "address",
        extractedValue: slice.trim(),
        confidence: crawlConfidenceForSource(ctx.sourceType, 0.72),
        sourceUrl: ctx.sourceUrl,
        sourceType: ctx.sourceType,
        extractionMethod: "regex",
        provenanceNote: postcodeMatch[0],
        extractedAt,
      });
    }
  }

  const hours = text.match(OPENING_HOURS);
  if (hours?.[0] && hours[0].length < 200) {
    out.push({
      entityId: ctx.entityId,
      entityType: ctx.entityType,
      fieldName: "opening_hours",
      extractedValue: hours[0].trim(),
      confidence: crawlConfidenceForSource(ctx.sourceType, 0.7),
      sourceUrl: ctx.sourceUrl,
      sourceType: ctx.sourceType,
      extractionMethod: "regex",
      extractedAt,
    });
  }

  return out;
}

export function contactPageCandidate(
  contactUrl: string,
  ctx: { entityId: string; entityType: string; sourceType: CrawlSourceType },
): ExtractedFieldCandidate {
  return {
    entityId: ctx.entityId,
    entityType: ctx.entityType,
    fieldName: "contact_page",
    extractedValue: contactUrl,
    confidence: crawlConfidenceForSource(ctx.sourceType, 0.88),
    sourceUrl: contactUrl,
    sourceType: ctx.sourceType,
    extractionMethod: "html_parse",
    extractedAt: new Date(),
  };
}
