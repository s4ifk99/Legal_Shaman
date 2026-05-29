import { extractPhonesFromText } from "@/lib/provider-enrichment/contact-extractor";

/** True when stored name is a placeholder, not a real firm name. */
export function isPlaceholderSraBusinessName(name: string, sraId: string): boolean {
  const n = name.trim();
  if (!n) return true;
  if (n === sraId.trim()) return true;
  if (/^Organisation\s+\d+$/i.test(n)) return true;
  if (/^\d{4,}$/.test(n)) return true;
  return false;
}

function looksLikeAddressLine(line: string): boolean {
  const l = line.trim();
  if (!l) return true;
  if (/\b(England|Scotland|Wales|United Kingdom|UK)\b/i.test(l) && /,/.test(l)) return true;
  if (/^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i.test(l)) return true;
  if (/^\d{1,4}\s+[A-Za-z]/.test(l) && /,/.test(l)) return true;
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
    return line;
  }
  return null;
}

export function resolveSraDisplayName(
  businessName: string,
  searchText: string,
  sraId: string,
): string {
  const trimmed = businessName.trim();
  if (!isPlaceholderSraBusinessName(trimmed, sraId)) return trimmed;
  const fromText = extractFirmNameFromSraSearchText(searchText, sraId);
  if (fromText) return fromText;
  return trimmed || `Organisation ${sraId}`;
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
