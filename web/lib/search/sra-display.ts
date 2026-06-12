import { extractPhonesFromText } from "@/lib/provider-enrichment/contact-extractor";

export type SraNameFields = {
  displayName?: string | null;
  tradingName?: string | null;
  organisationName?: string | null;
  firmName?: string | null;
  name?: string | null;
  title?: string | null;
  authorisationName?: string | null;
  recognisedBodyName?: string | null;
};

/** True when stored name is a placeholder, not a real firm name. */
export function isPlaceholderSraBusinessName(name: string, sraId: string): boolean {
  const n = name.trim();
  if (!n) return true;
  if (n === sraId.trim()) return true;
  if (/^Organisation\s+\d+$/i.test(n)) return true;
  if (/^SRA\s+organisation\s+\d+$/i.test(n)) return true;
  if (/^(sra|legal_aid|curated_listing):/i.test(n)) return true;
  if (/^\d{4,}$/.test(n)) return true;
  return false;
}

function looksLikeAddressLine(line: string): boolean {
  const l = line.trim();
  if (!l) return true;
  if (/\b(England|Scotland|Wales|United Kingdom|UK|Greece|UAE|Ireland|France|Germany|Spain|Italy)\b/i.test(l) && /,/.test(l)) {
    return true;
  }
  if (/^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i.test(l)) return true;
  if (/^\d{1,4}\s+[A-Za-z]/.test(l) && /,/.test(l)) return true;
  if (/,\s*\d{4,6}\s*,/i.test(l)) return true;
  if (/^[A-Z][A-Za-z\s.'-]+,\s*[A-Za-z\s.'-]+,\s*[A-Z]{1,2}\d/i.test(l)) return true;
  return false;
}

/**
 * When sync stored `Organisation {id}` but searchText has trading names (line after SRA id).
 */
export function extractFirmNameFromSraSearchText(searchText: string, sraId: string): string | null {
  const lines = searchText
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const sid = sraId.trim();

  for (const line of lines) {
    if (line === sid) continue;
    if (/^\d{4,}$/.test(line)) continue;
    if (line.length < 3) continue;
    if (looksLikeAddressLine(line)) continue;
    if (/^Organisation\s+\d+$/i.test(line)) continue;
    if (/^SRA\s+organisation\s+\d+$/i.test(line)) continue;
    return line;
  }
  return null;
}

function pickFirstRealName(candidates: (string | null | undefined)[], sraId: string): string | null {
  for (const c of candidates) {
    const t = c?.trim();
    if (t && !isPlaceholderSraBusinessName(t, sraId)) return t;
  }
  return null;
}

export function resolveSraDisplayName(
  businessName: string,
  searchText: string,
  sraId: string,
  extra?: SraNameFields,
): string {
  const fromFields = pickFirstRealName(
    [
      extra?.displayName,
      extra?.tradingName,
      extra?.organisationName,
      extra?.firmName,
      extra?.name,
      extra?.authorisationName,
      extra?.recognisedBodyName,
      extra?.title,
      businessName,
    ],
    sraId,
  );
  if (fromFields) return fromFields;

  const fromText = extractFirmNameFromSraSearchText(searchText, sraId);
  if (fromText) return fromText;

  const trimmed = businessName.trim();
  if (trimmed && !isPlaceholderSraBusinessName(trimmed, sraId)) return trimmed;

  return `SRA organisation ${sraId}`;
}

/** Best-effort UK phone from SRA searchText (after sync includes office telephones). */
export function extractPhoneFromSraSearchText(searchText: string): string | null {
  const phones = extractPhonesFromText(searchText, { officialPage: true });
  return phones[0]?.e164 ?? phones[0]?.display ?? null;
}

/** One-line summary for cards — drops SRA id line and duplicate firm name. */
export function formatSraCardDescription(
  description: string,
  businessName: string,
  sraId: string,
): string {
  const lines = description
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const filtered = lines.filter(
    (l) =>
      l !== sraId &&
      l !== businessName &&
      !/^Organisation\s+\d+$/i.test(l) &&
      !/^SRA\s+organisation\s+\d+$/i.test(l) &&
      !/^\d{4,}$/.test(l),
  );
  if (!filtered.length) return "";
  return filtered.slice(0, 4).join(" · ");
}

export function formatPhoneForDisplay(phone: string): string {
  const p = phone.trim();
  if (!p) return "";
  if (p.startsWith("+44")) {
    const national = `0${p.slice(3)}`;
    if (national.length === 11) {
      return `${national.slice(0, 5)} ${national.slice(5)}`;
    }
  }
  return p;
}

export function telHref(phone: string): string {
  return `tel:${phone.replace(/\s/g, "")}`;
}
