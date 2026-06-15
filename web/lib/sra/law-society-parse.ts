import { isUsableFirmNameCandidate } from "@/lib/sra/sra-name-quality";

export type ParsedLawSocietyResultRow = {
  organisationName: string;
  profileUrl: string;
  sraIdOnPage?: string;
  address?: string;
  phone?: string;
  website?: string;
  lawSocietyId?: string;
  practiceAreas: string[];
  solicitors: string[];
};

const ORG_PROFILE_RE =
  /href="(https:\/\/solicitors\.lawsociety\.org\.uk\/(?:organisation|office|person)\/[^"]+)"/gi;

const SRA_ID_RE = /\bSRA\s*(?:ID|number|No\.?|#)?\s*:?\s*(\d{4,})\b/gi;

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/gi, "'");
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function extractWebsiteFromText(text: string): string | undefined {
  const re = /https?:\/\/[^\s"'<>]+/gi;
  for (const m of text.matchAll(re)) {
    const u = m[0];
    try {
      const host = new URL(u).hostname.toLowerCase();
      if (
        host.includes("lawsociety.org.uk") ||
        host.includes("sra.org.uk") ||
        host.includes("google.") ||
        host.includes("gstatic.com") ||
        host.includes("facebook.")
      ) {
        continue;
      }
      return u;
    } catch {
      /* skip */
    }
  }
  return undefined;
}

function extractPhone(text: string): string | undefined {
  const m = text.match(
    /(?:Tel|Phone|Telephone)[:\s]*(\+?\d[\d\s().-]{8,18}\d)/i,
  );
  if (m?.[1]) return m[1].replace(/\s+/g, " ").trim();
  const generic = text.match(/(\+44[\d\s]{9,15}|0\d{2,4}[\s\d]{7,12})/);
  return generic?.[1]?.replace(/\s+/g, " ").trim();
}

/** Parse Law Society search results HTML for organisation rows. */
export function parseLawSocietySearchResultsHtml(
  html: string,
  targetSraId: string,
): ParsedLawSocietyResultRow[] {
  const rows: ParsedLawSocietyResultRow[] = [];
  const seen = new Set<string>();

  const cardRe =
    /<(?:article|li|div)[^>]*class="[^"]*(?:search-result|result-item|card)[^"]*"[^>]*>([\s\S]*?)<\/(?:article|li|div)>/gi;

  let cardMatch: RegExpExecArray | null;
  const chunks: string[] = [];
  while ((cardMatch = cardRe.exec(html))) {
    chunks.push(cardMatch[1]!);
  }
  if (chunks.length === 0) chunks.push(html);

  for (const chunk of chunks) {
    const profileUrls: string[] = [];
    let m: RegExpExecArray | null;
    const profileRe = new RegExp(ORG_PROFILE_RE.source, "gi");
    while ((m = profileRe.exec(chunk))) {
      profileUrls.push(decodeEntities(m[1]!));
    }

    if (!profileUrls.length) continue;

    const text = stripTags(chunk);
    const sraIds: string[] = [];
    const sraRe = new RegExp(SRA_ID_RE.source, "gi");
    while ((m = sraRe.exec(chunk))) {
      sraIds.push(m[1]!);
    }

    const nameMatch =
      chunk.match(/<h[23][^>]*>([^<]{3,200})<\/h[23]>/i) ??
      chunk.match(/class="[^"]*(?:org-name|organisation-name|title)[^"]*"[^>]*>([^<]{3,200})</i);

    const organisationName = nameMatch
      ? stripTags(nameMatch[1]!)
      : text.split("SRA")[0]?.trim().slice(0, 120) ?? "";

    if (!organisationName || !isUsableFirmNameCandidate(organisationName, targetSraId)) {
      continue;
    }

    for (const profileUrl of profileUrls) {
      if (seen.has(profileUrl)) continue;
      seen.add(profileUrl);
      rows.push({
        organisationName,
        profileUrl,
        sraIdOnPage: sraIds[0],
        address: extractAddressFromText(text),
        phone: extractPhone(text),
        website: extractWebsiteFromText(chunk),
        practiceAreas: extractPracticeAreas(text),
        solicitors: extractSolicitors(chunk),
        lawSocietyId: extractLawSocietyId(profileUrl),
      });
    }
  }

  if (rows.length === 0) {
    const profileRe = new RegExp(ORG_PROFILE_RE.source, "gi");
    let pm: RegExpExecArray | null;
    while ((pm = profileRe.exec(html))) {
      const profileUrl = decodeEntities(pm[1]!);
      if (seen.has(profileUrl)) continue;
      seen.add(profileUrl);
      const window = html.slice(
        Math.max(0, pm.index - 800),
        Math.min(html.length, pm.index + 1200),
      );
      const text = stripTags(window);
      const nameMatch = window.match(/<h[23][^>]*>([^<]{3,200})<\/h[23]>/i);
      const organisationName = nameMatch ? stripTags(nameMatch[1]!) : "";
      if (!organisationName || !isUsableFirmNameCandidate(organisationName, targetSraId)) {
        continue;
      }
      const sraRe = new RegExp(SRA_ID_RE.source, "gi");
      const sraM = sraRe.exec(window);
      rows.push({
        organisationName,
        profileUrl,
        sraIdOnPage: sraM?.[1],
        address: extractAddressFromText(text),
        phone: extractPhone(text),
        website: extractWebsiteFromText(window),
        practiceAreas: extractPracticeAreas(text),
        solicitors: extractSolicitors(window),
        lawSocietyId: extractLawSocietyId(profileUrl),
      });
    }
  }

  return rows;
}

export function parseLawSocietyProfileHtml(html: string): Partial<ParsedLawSocietyResultRow> {
  const text = stripTags(html);
  const name =
    html.match(/<h1[^>]*>([^<]{3,200})<\/h1>/i)?.[1] ??
    html.match(/property="name"[^>]*content="([^"]+)"/i)?.[1];
  const sraRe = new RegExp(SRA_ID_RE.source, "gi");
  const sraM = sraRe.exec(html);

  return {
    organisationName: name ? stripTags(name) : undefined,
    sraIdOnPage: sraM?.[1],
    address: extractAddressFromText(text),
    phone: extractPhone(text),
    website: extractWebsiteFromText(html),
    practiceAreas: extractPracticeAreas(text),
    solicitors: extractSolicitors(html),
  };
}

function extractAddressFromText(text: string): string | undefined {
  const m = text.match(
    /(?:Address|Office)[:\s]*([A-Za-z0-9\s,'.-]{10,120}(?:[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})?)/i,
  );
  if (m?.[1]) return m[1].trim();
  const postcode = text.match(
    /\b([A-Za-z][A-Za-z\s.'-]{2,40},\s*[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/,
  );
  return postcode?.[1]?.trim();
}

function extractPracticeAreas(text: string): string[] {
  const areas: string[] = [];
  const re = /(?:practice area|areas of practice|specialis(?:m|z)ation)s?[:\s]*([^.]{5,120})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    for (const part of m[1]!.split(/[,;|]/)) {
      const t = part.trim();
      if (t.length > 2 && t.length < 80) areas.push(t);
    }
  }
  return [...new Set(areas)].slice(0, 12);
}

function extractSolicitors(html: string): string[] {
  const names: string[] = [];
  const re = /href="https:\/\/solicitors\.lawsociety\.org\.uk\/person\/[^"]+"[^>]*>([^<]{3,80})</gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const n = stripTags(m[1]!);
    if (n.length > 2) names.push(n);
  }
  return [...new Set(names)].slice(0, 20);
}

function extractLawSocietyId(profileUrl: string): string | undefined {
  const m = profileUrl.match(/\/(?:organisation|office|person)\/(\d+)/i);
  return m?.[1];
}

export function normalisePostcode(s: string): string {
  return s.replace(/\s+/g, "").toUpperCase();
}

export function postcodesMatch(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  return normalisePostcode(a).includes(normalisePostcode(b)) ||
    normalisePostcode(b).includes(normalisePostcode(a));
}
