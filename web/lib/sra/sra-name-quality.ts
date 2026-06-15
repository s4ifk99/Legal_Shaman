import { isPlaceholderSraBusinessName } from "@/lib/search/sra-display";

export type SraNameClassification =
  | "real_firm_name"
  | "placeholder"
  | "address_like_name"
  | "id_only"
  | "empty";

const PLACEHOLDER_DISPLAY_RE = /^SRA\s+organisation\s+\d+$/i;
const ORG_PLACEHOLDER_RE = /^Organisation\s+\d+$/i;

/** Matches display_name placeholders like "SRA organisation 1002231". */
export function isPlaceholderSraDisplayName(name: string, sraId?: string): boolean {
  const n = name.trim();
  if (!n) return true;
  if (PLACEHOLDER_DISPLAY_RE.test(n)) return true;
  if (ORG_PLACEHOLDER_RE.test(n)) return true;
  return isPlaceholderSraBusinessName(n, sraId ?? "");
}

/** Reject strings that are addresses mis-stored as firm names. */
export function isAddressLikeName(name: string): boolean {
  const n = name.trim();
  if (!n) return false;

  if (/^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i.test(n) && n.length < 40) return true;

  if (
    /^[A-Za-z\s.'-]+,\s*[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i.test(n) &&
    !/\b(LLP|Ltd|Limited|PLC|Solicitors?|Law|Chambers|Partners)\b/i.test(n)
  ) {
    return true;
  }

  if (
    /^\d+\s+[A-Za-z0-9].*,\s*.+[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i.test(n) &&
    !/\b(LLP|Ltd|Limited|PLC|Solicitors?|Law|Chambers|Partners)\b/i.test(n)
  ) {
    return true;
  }

  const commaParts = n.split(",").map((p) => p.trim()).filter(Boolean);
  if (commaParts.length >= 2) {
    const last = commaParts[commaParts.length - 1]!;
    const geoTail =
      /^(United Kingdom|UK|England|Scotland|Wales|United Arab Emirates|UAE|Greece|Ireland|France|Germany|Spain|Italy)$/i;
    if (geoTail.test(last) && !/\b(LLP|Ltd|Limited|PLC|Solicitors?|Law)\b/i.test(n)) {
      return true;
    }
    if (
      commaParts.length === 2 &&
      /^[A-Za-z\s.'-]{2,40}$/.test(commaParts[0]!) &&
      geoTail.test(commaParts[1]!)
    ) {
      return true;
    }
  }

  if (/^\d{4,6}\s*,\s*[A-Za-z]/i.test(n)) return true;

  const knownBad = [
    /^London,\s*SW\d/i,
    /^Dubai,\s*United Arab Emirates$/i,
    /^ABU DHABI,\s*United Arab Emirates$/i,
    /^Piraeus,\s*185\s*36,\s*Greece$/i,
  ];
  if (knownBad.some((re) => re.test(n))) return true;

  return false;
}

/** Reject page markup / script fragments mis-parsed as firm names. */
export function isHtmlOrScriptArtifact(name: string): boolean {
  const n = name.trim();
  if (!n) return false;
  if (/^\/\//.test(n)) return true;
  if (/^\s*\/\*|\*\/\s*$/.test(n)) return true;
  if (/\b(function|dataLayer|gtag|window\.|document\.|addEventListener)\b/i.test(n)) {
    return true;
  }
  if (/[{}();]/.test(n) && !/\b(LLP|Ltd|Limited)\b/i.test(n)) return true;
  return false;
}

export function classifySraStoredName(
  name: string,
  sraId: string,
): SraNameClassification {
  const n = name.trim();
  if (!n) return "empty";
  if (isHtmlOrScriptArtifact(n)) return "placeholder";
  if (/^\d{4,}$/.test(n) || n === sraId) return "id_only";
  if (isPlaceholderSraDisplayName(n, sraId)) return "placeholder";
  if (isAddressLikeName(n)) return "address_like_name";
  return "real_firm_name";
}

export function isUsableFirmNameCandidate(name: string, sraId: string): boolean {
  return classifySraStoredName(name, sraId) === "real_firm_name";
}
