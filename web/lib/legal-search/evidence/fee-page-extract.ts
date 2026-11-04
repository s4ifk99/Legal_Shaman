/**
 * Extract structured GBP fee ranges from SRA transparency / pricing page text.
 * Conservative: only returns a candidate when a clear £ amount (or range) is found.
 */

export type FeeExtractCandidate = {
  service: string;
  minPence: number;
  maxPence: number;
  currency: "GBP";
  vatNote?: string;
};

function poundsToPence(pounds: number): number {
  return Math.round(pounds * 100);
}

function parseGbpToken(raw: string): number | null {
  const cleaned = raw.replace(/,/g, "").replace(/£/g, "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000) return null;
  return n;
}

const RANGE_RE =
  /£\s*([\d,]+(?:\.\d{1,2})?)\s*(?:–|-|to|and)\s*£?\s*([\d,]+(?:\.\d{1,2})?)/gi;
const FROM_RE = /(?:from|starting\s+at|fees?\s+from)\s*£\s*([\d,]+(?:\.\d{1,2})?)/gi;
const SINGLE_RE = /£\s*([\d,]+(?:\.\d{1,2})?)/gi;

const SERVICE_HINTS: Array<{ re: RegExp; label: string }> = [
  { re: /unfair\s+dismissal|wrongful\s+dismissal|employment\s+tribunal/i, label: "employment tribunal (unfair or wrongful dismissal)" },
  { re: /probate/i, label: "probate" },
  { re: /conveyanc|residential\s+purchase|residential\s+sale/i, label: "conveyancing" },
  { re: /immigration|visa\s+application/i, label: "immigration applications" },
  { re: /legal\s+costs|our\s+fees|price\s+transparency|pricing/i, label: "listed legal service" },
];

function inferService(text: string, fallback: string): string {
  for (const hint of SERVICE_HINTS) {
    if (hint.re.test(text)) return hint.label;
  }
  return fallback;
}

function vatNoteFrom(text: string): string | undefined {
  if (/inclusive\s+of\s+VAT|inc\.?\s*VAT|including\s+VAT/i.test(text)) {
    return "inclusive of VAT";
  }
  if (/exclusive\s+of\s+VAT|plus\s+VAT|excluding\s+VAT|\+\s*VAT/i.test(text)) {
    return "exclusive of VAT";
  }
  return undefined;
}

/**
 * Pull the first plausible fee range from page text.
 * Prefers explicit ranges, then "from £X", then a single £ amount used as both min and max.
 */
export function extractPublishedFeeFromText(
  text: string,
  opts?: { defaultService?: string },
): FeeExtractCandidate | null {
  const body = text.replace(/\s+/g, " ").trim();
  if (!body || body.length < 20) return null;

  const window = body.slice(0, 12_000);
  const service = inferService(window, opts?.defaultService?.trim() || "listed legal service");
  const vatNote = vatNoteFrom(window);

  RANGE_RE.lastIndex = 0;
  const range = RANGE_RE.exec(window);
  if (range) {
    const min = parseGbpToken(range[1]!);
    const max = parseGbpToken(range[2]!);
    if (min != null && max != null && min <= max) {
      return {
        service,
        minPence: poundsToPence(min),
        maxPence: poundsToPence(max),
        currency: "GBP",
        vatNote,
      };
    }
  }

  FROM_RE.lastIndex = 0;
  const from = FROM_RE.exec(window);
  if (from) {
    const min = parseGbpToken(from[1]!);
    if (min != null) {
      return {
        service,
        minPence: poundsToPence(min),
        maxPence: poundsToPence(min),
        currency: "GBP",
        vatNote,
      };
    }
  }

  // Avoid grabbing tiny amounts (e.g. £50 admin) as the headline fee when no range/from.
  SINGLE_RE.lastIndex = 0;
  let best: number | null = null;
  let match: RegExpExecArray | null;
  while ((match = SINGLE_RE.exec(window)) !== null) {
    const pounds = parseGbpToken(match[1]!);
    if (pounds == null || pounds < 100) continue;
    if (best == null || pounds > best) best = pounds;
  }
  if (best != null) {
    return {
      service,
      minPence: poundsToPence(best),
      maxPence: poundsToPence(best),
      currency: "GBP",
      vatNote,
    };
  }

  return null;
}

export function isHttpsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}
