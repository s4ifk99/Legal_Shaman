/**
 * UK-centric location parsing and scoring helpers.
 * When lat/lng are absent (common), falls back to city / postcode text.
 */

const UK_POSTCODE_RE =
  /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}|[A-Z]{1,2}\d{1,2}\s?\d[A-Z]{2})\b/i;

export type ParsedLocation = {
  city?: string;
  postcode?: string;
  outwardCode?: string;
  radiusMiles?: number;
  nearMe?: boolean;
};

/** Detect "near me" style phrasing (no geolocation in MVP — flag only). */
export function detectNearMe(q: string): boolean {
  return /\bnear\s+me\b/i.test(q) || /\bclose\s+to\s+me\b/i.test(q);
}

/** Extract first UK-ish postcode from text; normalise spacing to uppercase compact form. */
export function extractPostcode(text: string): string | undefined {
  const m = text.match(UK_POSTCODE_RE);
  if (!m?.[1]) return undefined;
  return m[1].replace(/\s+/g, " ").toUpperCase().trim();
}

/** Outward code: e.g. SW1A from SW1A 1AA */
export function outwardFromPostcode(postcode: string): string | undefined {
  const compact = postcode.replace(/\s+/g, "").toUpperCase();
  const m = compact.match(/^([A-Z]{1,2}\d[A-Z\d]?|\d[A-Z]{2})/);
  if (!m) return undefined;
  // UK: outward is usually letters+digits before last 3 chars
  if (compact.length < 4) return undefined;
  const inwardStart = compact.length - 3;
  return compact.slice(0, inwardStart);
}

export function parseLocationFromQuery(q: string): ParsedLocation {
  const nearMe = detectNearMe(q);
  const postcode = extractPostcode(q);
  const outwardCode = postcode ? outwardFromPostcode(postcode) : undefined;
  const radiusMiles = extractRadiusMiles(q);
  return { postcode, outwardCode, nearMe, radiusMiles };
}

function extractRadiusMiles(q: string): number | undefined {
  const m = q.match(/\bwithin\s+(\d+)\s*(mi|miles|mile)\b/i);
  if (m?.[1]) return Math.min(100, Math.max(1, parseInt(m[1], 10)));
  const m2 = q.match(/\b(\d+)\s*(mi|miles)\s+radius\b/i);
  if (m2?.[1]) return Math.min(100, Math.max(1, parseInt(m2[1], 10)));
  return undefined;
}

export type LatLng = { lat: number; lng: number };

/** Haversine distance in miles. */
export function distanceMiles(a: LatLng, b: LatLng): number {
  const R = 3958.8;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Score [0,1] for location match when only text fields exist. */
export function textLocationScore(args: {
  queryCity?: string;
  queryPostcode?: string;
  resultCity: string;
  resultPostcode: string;
}): number {
  const qc = args.queryCity?.toLowerCase().trim();
  const qp = args.queryPostcode?.toUpperCase().replace(/\s+/g, "");
  const rc = args.resultCity.toLowerCase().trim();
  const rp = args.resultPostcode.toUpperCase().replace(/\s+/g, "");
  if (qc && rc === qc) return 1;
  if (qp && rp.startsWith(qp.slice(0, Math.min(4, qp.length)))) return 0.85;
  if (qc && rc.includes(qc)) return 0.7;
  if (!qc && !qp) return 0.5;
  return 0.2;
}
