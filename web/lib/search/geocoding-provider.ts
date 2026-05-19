/**
 * Geocoding for index build only — not called on user search hot path.
 */

export type GeocodeResult = {
  latitude: number;
  longitude: number;
  address?: string;
  city?: string;
  postcode?: string;
  provider: string;
  confidence: number;
};

const NOMINATIM_UA =
  process.env.GEOCODING_USER_AGENT?.trim() || "LegalShaman/1.0 (directory indexer)";

export async function geocodeUkPostcode(postcode: string): Promise<GeocodeResult | null> {
  const pc = postcode.trim().replace(/\s+/g, "");
  if (pc.length < 5) return null;
  try {
    const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(pc)}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      result?: { latitude: number; longitude: number; admin_district?: string; postcode?: string };
    };
    const r = data.result;
    if (r == null || !Number.isFinite(r.latitude)) return null;
    return {
      latitude: r.latitude,
      longitude: r.longitude,
      city: r.admin_district,
      postcode: r.postcode,
      provider: "postcodes.io",
      confidence: 0.95,
    };
  } catch {
    return null;
  }
}

export async function geocodeNominatim(query: string): Promise<GeocodeResult | null> {
  const q = query.trim();
  if (q.length < 4) return null;
  try {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", `${q}, United Kingdom`);
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", "1");
    url.searchParams.set("countrycodes", "gb");
    const res = await fetch(url.toString(), {
      headers: { "User-Agent": NOMINATIM_UA },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const arr = (await res.json()) as { lat: string; lon: string; display_name?: string }[];
    const hit = arr[0];
    if (!hit) return null;
    const lat = Number(hit.lat);
    const lng = Number(hit.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return {
      latitude: lat,
      longitude: lng,
      address: hit.display_name,
      provider: "nominatim",
      confidence: 0.7,
    };
  } catch {
    return null;
  }
}

export async function geocodeUkLocation(parts: {
  postcode?: string;
  city?: string;
  address?: string;
}): Promise<GeocodeResult | null> {
  if (parts.postcode?.trim()) {
    const pc = await geocodeUkPostcode(parts.postcode);
    if (pc) return pc;
  }
  const q = [parts.address, parts.city].filter(Boolean).join(", ");
  if (q.length >= 4) return geocodeNominatim(q);
  if (parts.city?.trim()) return geocodeNominatim(parts.city);
  return null;
}
