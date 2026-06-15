import { parsePhoneNumberFromString } from "libphonenumber-js";
import { isRegulatoryOrDirectoryUrl } from "@/lib/provider-enrichment/regulatory-url-filter";

export type ExtractedPhone = {
  e164: string;
  display: string;
  national: string;
  confidence: number;
  evidence: string;
};

const UK_PHONE_CANDIDATE =
  /(?:\+44\s?|0)(?:\d[\s-]?){9,12}\d/g;

const FOOTER_NOISE =
  /\b(copyright|cookie|privacy policy|terms and conditions|follow us|newsletter)\b/i;

function fallbackUkParse(evidence: string): ExtractedPhone | null {
  const digits = evidence.replace(/[^\d+]/g, "");
  let national = digits.replace(/^\+44/, "").replace(/^0/, "");
  if (national.length < 9 || national.length > 11) return null;
  if (/^0+$/.test(national)) return null;
  const e164 = `+44${national}`;
  return {
    e164,
    display: evidence.trim(),
    national,
    confidence: 0.7,
    evidence: evidence.trim(),
  };
}

/**
 * Extract UK phone numbers from page text. Never invents numbers — regex matches only.
 */
export function extractPhonesFromText(
  text: string,
  opts?: { officialPage?: boolean },
): ExtractedPhone[] {
  if (FOOTER_NOISE.test(text.slice(-800)) && !opts?.officialPage) {
    text = text.slice(0, Math.max(0, text.length - 800));
  }

  const matches = text.match(UK_PHONE_CANDIDATE) ?? [];
  const out: ExtractedPhone[] = [];
  const seen = new Set<string>();

  for (const raw of matches) {
    const evidence = raw.trim();
    let parsed: ReturnType<typeof parsePhoneNumberFromString> | undefined;
    try {
      parsed = parsePhoneNumberFromString(evidence, "GB");
      if (!parsed?.isValid()) parsed = parsePhoneNumberFromString(evidence);
    } catch {
      parsed = undefined;
    }
    if (parsed?.isValid() && parsed.country && parsed.country !== "GB") continue;

    if (parsed?.isValid()) {
      const e164 = parsed.format("E.164");
      if (seen.has(e164)) continue;
      seen.add(e164);
      out.push({
        e164,
        display: parsed.format("NATIONAL"),
        national: parsed.nationalNumber,
        confidence: opts?.officialPage ? 0.88 : 0.72,
        evidence,
      });
      continue;
    }

    const fallback = fallbackUkParse(evidence);
    if (fallback && !seen.has(fallback.e164)) {
      seen.add(fallback.e164);
      out.push({
        ...fallback,
        confidence: opts?.officialPage ? 0.75 : 0.65,
      });
    }
  }

  return out.sort((a, b) => b.confidence - a.confidence);
}

export function extractEmailFromText(text: string): { email: string; confidence: number } | null {
  const m = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  if (!m) return null;
  const email = m[0].toLowerCase();
  if (/example\.(com|org)|noreply|donotreply/i.test(email)) return null;
  return { email, confidence: 0.8 };
}

export function extractWebsiteFromText(
  text: string,
  baseUrl?: string,
  opts?: { allowRegulatoryBase?: boolean },
): string | null {
  const m = text.match(/https?:\/\/[^\s"'<>]+/i);
  if (m) {
    const url = m[0].replace(/[),.;]+$/, "");
    if (isRegulatoryOrDirectoryUrl(url)) return null;
    return url;
  }
  if (baseUrl) {
    try {
      const origin = new URL(baseUrl).origin;
      if (!opts?.allowRegulatoryBase && isRegulatoryOrDirectoryUrl(origin)) return null;
      return origin;
    } catch {
      return null;
    }
  }
  return null;
}
