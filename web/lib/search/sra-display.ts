import { extractPhonesFromText } from "@/lib/provider-enrichment/contact-extractor";
import { isKnownSraWorkAreaLabel } from "@/lib/sra/work-area-slugs";

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

export type SraAboutField = { label: string; value: string };

function isEmailLine(line: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(line.trim());
}

function isWebsiteLine(line: string): boolean {
  return /^https?:\/\//i.test(line.trim());
}

function isPhoneLine(line: string): boolean {
  const digits = line.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15 && /^[\d+\s()\-./]+$/.test(line.trim());
}

function normalizePhoneDigits(phone: string): string {
  return phone.replace(/\D/g, "");
}

function isAuthorisationLine(line: string): boolean {
  return /^(yes|no|authorised|authorized|not authorised|not authorized)$/i.test(line.trim());
}

function looksLikePracticeAreaLine(line: string): boolean {
  const l = line.trim();
  if (!l || l.length < 3) return false;
  if (/^areas? of law\b/i.test(l)) return false;
  if (/\b(LLP|Ltd|Limited|Solicitors?|Chambers|Partners|Attorneys)\b/i.test(l)) return false;
  if (
    /^[A-Z][A-Z0-9 &.'-]{0,40}\b(Legal|Law)\s*$/i.test(l) &&
    !isKnownSraWorkAreaLabel(l)
  ) {
    return false;
  }
  if (isKnownSraWorkAreaLabel(l)) return true;
  if (/\//.test(l)) return true;
  if (/\bwork for\b/i.test(l)) return true;
  if (
    /^(commercial|corporate|employment|immigration|family|housing|criminal|litigation|conveyancing|probate|personal injury|intellectual property|crime|children|debt|welfare|mental health|community care|planning|tax|insolvency|consumer|administrative|motoring|fraud|maritime|aviation|sports|charity|agricultural|military|environmental|construction|defamation|data protection|banking|wills|probate and estate|litigation\s*-\s*other)\b/i.test(
      l,
    )
  ) {
    return true;
  }
  if (/\b(law|legal)\b/i.test(l) && l.length <= 48) return true;
  if (l.length <= 40 && /\b(and|\/|-)\b/.test(l) && /\b(law|rights|care|disputes?|claims?|negligence|conveyancing)\b/i.test(l)) {
    return true;
  }
  return false;
}

/** Split SRA register lines like "Family / Crime / Housing" into separate labels. */
function splitCompoundPracticeAreaLine(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  if (isKnownSraWorkAreaLabel(trimmed)) return [trimmed];
  if (trimmed.includes("/")) {
    return trimmed
      .split(/\s*\/\s*/)
      .map((p) => p.trim())
      .filter((p) => p.length >= 3);
  }
  return [trimmed];
}

/** Practice-area lines embedded in SRA `searchText` (from WorkArea / AreasOfLaw sync). */
export function extractPracticeAreaLinesFromSraSearchText(searchText: string): string[] {
  const lines = searchText
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    if (!looksLikePracticeAreaLine(line)) continue;
    for (const part of splitCompoundPracticeAreaLine(line)) {
      const key = part.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(part);
    }
  }

  return out;
}

function looksLikeTradingName(line: string, businessName: string): boolean {
  const l = line.trim();
  if (!l || l === businessName) return false;
  if (looksLikeAddressLine(l) || isEmailLine(l) || isWebsiteLine(l) || isPhoneLine(l)) return false;
  if (looksLikePracticeAreaLine(l)) return false;
  if (/^(yes|no)$/i.test(l)) return false;
  return /\b(LLP|Ltd|Limited|Solicitors|Law|Legal|Partners|Chambers|Attorneys)\b/i.test(l);
}

export type ParseSraAboutFieldsOptions = {
  businessName?: string;
  sraId?: string;
  /** Omit phone lines already shown in the contact row. */
  excludePhone?: string;
  /** Omit practice-area lines already listed above the About section. */
  listedPracticeAreas?: string[];
};

/**
 * Turn newline-separated SRA `searchText` into labelled About fields for the detail panel.
 */
export function parseSraAboutFields(
  searchText: string,
  options: ParseSraAboutFieldsOptions = {},
): SraAboutField[] {
  const lines = searchText
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return [];

  const businessName = options.businessName?.trim() ?? "";
  const sraId = options.sraId?.trim() ?? "";
  const excludePhoneDigits = options.excludePhone ? normalizePhoneDigits(options.excludePhone) : "";
  const listedPractice = new Set(
    (options.listedPracticeAreas ?? []).map((p) => p.trim().toLowerCase()).filter(Boolean),
  );

  const fields: SraAboutField[] = [];
  const practiceLines: string[] = [];
  const seen = new Set<string>();

  const pushField = (label: string, value: string) => {
    const key = `${label}:${value}`;
    if (seen.has(key)) return;
    seen.add(key);
    fields.push({ label, value });
  };

  for (const line of lines) {
    if (businessName && line === businessName) continue;
    if (/^Organisation\s+\d+$/i.test(line) || /^SRA\s+organisation\s+\d+$/i.test(line)) continue;

    if (sraId && (line === sraId || (/^\d{4,}$/.test(line) && line === sraId))) {
      pushField("SRA number", line);
      continue;
    }

    if (isEmailLine(line)) {
      pushField("Email", line);
      continue;
    }

    if (isWebsiteLine(line)) {
      pushField("Website", line);
      continue;
    }

    if (isPhoneLine(line)) {
      if (excludePhoneDigits && normalizePhoneDigits(line) === excludePhoneDigits) continue;
      pushField("Phone", line);
      continue;
    }

    if (isAuthorisationLine(line)) {
      pushField("Authorisation", line);
      continue;
    }

    if (looksLikeAddressLine(line)) {
      pushField("Address", line);
      continue;
    }

    if (businessName && looksLikeTradingName(line, businessName)) {
      pushField("Trading name", line);
      continue;
    }

    if (looksLikePracticeAreaLine(line)) {
      if (!listedPractice.has(line.toLowerCase())) practiceLines.push(line);
      continue;
    }

    if (/^\d{4,}$/.test(line)) continue;
  }

  if (practiceLines.length) {
    pushField("Areas of law (SRA register)", practiceLines.join("; "));
  }

  return fields;
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
