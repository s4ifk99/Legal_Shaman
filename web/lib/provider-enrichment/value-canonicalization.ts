import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { parsePhoneNumberFromString } = require("libphonenumber-js") as {
  parsePhoneNumberFromString: (
    text: string,
    country?: string,
  ) => { isValid: () => boolean; format: (f: string) => string } | undefined;
};

export function canonicalPhone(value: string): string | null {
  try {
    const p = parsePhoneNumberFromString(value, "GB");
    if (p?.isValid()) return p.format("E.164");
  } catch {
    /* fall through */
  }
  const digits = value.replace(/\D/g, "");
  if (digits.startsWith("44") && digits.length >= 11) return `+${digits}`;
  if (digits.startsWith("0") && digits.length >= 10) return `+44${digits.slice(1)}`;
  return null;
}

export function canonicalEmail(value: string): string | null {
  const e = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null;
  return e;
}

export function emailDomain(email: string): string | null {
  const c = canonicalEmail(email);
  if (!c) return null;
  return c.split("@")[1] ?? null;
}

export function canonicalWebsiteOrigin(value: string): string | null {
  try {
    const url = new URL(value.startsWith("http") ? value : `https://${value}`);
    return url.origin.toLowerCase();
  } catch {
    return null;
  }
}

export function hostMatchesOfficialWebsite(
  emailOrUrl: string,
  officialWebsiteUrl?: string,
): boolean {
  if (!officialWebsiteUrl) return false;
  const officialHost = canonicalWebsiteOrigin(officialWebsiteUrl);
  if (!officialHost) return false;
  const domain = emailDomain(emailOrUrl);
  if (domain) {
    const officialDomain = new URL(officialHost).hostname.replace(/^www\./, "");
    return domain === officialDomain || domain.endsWith(`.${officialDomain}`);
  }
  const candidateHost = canonicalWebsiteOrigin(emailOrUrl);
  if (!candidateHost) return false;
  return candidateHost === officialHost;
}

export function canonicalPracticeAreaSlugs(value: string): string {
  return value
    .split(/[,;|]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join("|");
}

export function valuesCanonicallyEqual(
  fieldName: string,
  a: string,
  b: string,
): boolean {
  if (a.trim() === b.trim()) return true;
  switch (fieldName) {
    case "phone":
    case "phone_raw": {
      const ca = canonicalPhone(a);
      const cb = canonicalPhone(b);
      return Boolean(ca && cb && ca === cb);
    }
    case "email":
      return canonicalEmail(a) === canonicalEmail(b);
    case "website":
    case "contact_page":
    case "contactPageUrl":
      return canonicalWebsiteOrigin(a) === canonicalWebsiteOrigin(b);
    case "practice_areas":
    case "practiceAreaSlugs":
      return canonicalPracticeAreaSlugs(a) === canonicalPracticeAreaSlugs(b);
    default:
      return a.trim().toLowerCase() === b.trim().toLowerCase();
  }
}
