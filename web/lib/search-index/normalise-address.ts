/** UK postcode outward + inward normalisation. */
export function normalisePostcode(raw: string): string {
  const s = raw.trim().toUpperCase().replace(/\s+/g, " ");
  const m = s.match(/^([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})$/i);
  if (m) return `${m[1]} ${m[2]}`;
  return s;
}

export function normaliseCity(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  return t.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\s+/g, " ");
}

export function geocodeCacheKey(parts: {
  postcode?: string;
  city?: string;
  address?: string;
}): string {
  const pc = parts.postcode ? normalisePostcode(parts.postcode) : "";
  const city = parts.city?.trim().toLowerCase() ?? "";
  const addr = parts.address?.trim().toLowerCase().slice(0, 200) ?? "";
  if (pc) return `pc:${pc}`;
  if (city && addr) return `addr:${city}|${addr}`;
  if (city) return `city:${city}`;
  if (addr) return `addr:${addr}`;
  return "";
}
